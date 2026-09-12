import { createHash, createHmac } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export class AWS {
  private AccessKeyId: string;
  private SecretAccessKey: string;
  private endpoint: string;
  private service: string;
  private version: string;
  private region: string;
  private etag = '';

  constructor(AccessKeyId: string, SecretAccessKey: string, endpoint: string, service: string, version: string, region: string) {
    this.AccessKeyId = AccessKeyId;
    this.SecretAccessKey = SecretAccessKey;
    this.endpoint = endpoint;
    this.service = service;
    this.version = version;
    this.region = region;
  }

  async request(method: 'GET' | 'POST' | 'DELETE', action: string, params: Record<string, any> = {}): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) filtered[k] = v;
    }

    let body = '';
    let query: Record<string, any> = {};
    if (method === 'GET' || method === 'DELETE') {
      query = filtered;
    } else if (Object.keys(filtered).length > 0) {
      body = JSON.stringify(filtered);
    }

    const date = this.amzDate();
    const headers: Record<string, string> = {
      Host: this.endpoint,
      'X-Amz-Target': action,
      'X-Amz-Date': date,
    };
    if (body) headers['Content-Type'] = 'application/x-amz-json-1.1';
    const path = '/';

    headers['Authorization'] = this.generateSign(method, path, query, headers, body, date);

    let url = 'https://' + this.endpoint + path;
    const qs = this.buildQuery(query);
    if (qs) url += '?' + qs;
    return await this.curl(method, url, body, headers, false);
  }

  async requestXml(method: 'GET' | 'POST' | 'DELETE', action: string, params: Record<string, any> = {}): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) filtered[k] = v;
    }

    let body = '';
    let query: Record<string, any> = {
      Action: action,
      Version: this.version,
    };
    if (method === 'GET' || method === 'DELETE') {
      query = { ...query, ...filtered };
    } else if (Object.keys(filtered).length > 0) {
      body = this.buildForm(filtered);
    }

    const date = this.amzDate();
    const headers: Record<string, string> = {
      Host: this.endpoint,
      'X-Amz-Date': date,
    };

    const path = '/';
    headers['Authorization'] = this.generateSign(method, path, query, headers, body, date);

    let url = 'https://' + this.endpoint + path;
    const qs = this.buildQuery(query);
    if (qs) url += '?' + qs;
    return await this.curl(method, url, body, headers, true);
  }

  async requestXmlN(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, params: Record<string, any> = {}, rootTag?: string, etag = false): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) filtered[k] = v;
    }

    const fullPath = '/' + this.version + path;
    let body = '';
    let query: Record<string, any> = {};
    if (method === 'GET' || method === 'DELETE') {
      query = filtered;
    } else if (Object.keys(filtered).length > 0 || rootTag) {
      if (rootTag) {
        const tagName = rootTag.split(/[\s>]/)[0];
        const inner = Object.keys(filtered).map((k) => this.buildNode(k, filtered[k])).join('');
        body = '<' + rootTag + '>' + inner + '</' + tagName + '>';
      } else {
        body = this.buildNode('root', filtered);
      }
    }

    const date = this.amzDate();
    const headers: Record<string, string> = {
      Host: this.endpoint,
      'X-Amz-Date': date,
    };
    if (method !== 'GET' && method !== 'DELETE') {
      headers['Content-Type'] = 'application/xml';
    }
    if (etag && this.etag) {
      headers['If-Match'] = this.etag;
    }

    headers['Authorization'] = this.generateSign(method, fullPath, query, headers, body, date);

    let url = 'https://' + this.endpoint + fullPath;
    const qs = this.buildQuery(query);
    if (qs) url += '?' + qs;
    return await this.curl(method, url, body, headers, true, etag);
  }

  private amzDate(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  }

  private xmlEscape(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private buildNode(name: string, value: any): string {
    if (Array.isArray(value)) {
      return value.map((v) => this.buildNode(name, v)).join('');
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length > 0 && /^\d+$/.test(keys[0])) {
        return keys.map((k) => this.buildNode(name, value[k])).join('');
      }
      const inner = keys.map((k) => this.buildNode(k, value[k])).join('');
      return '<' + name + '>' + inner + '</' + name + '>';
    }
    return '<' + name + '>' + this.xmlEscape(value) + '</' + name + '>';
  }

  private generateSign(method: string, path: string, query: Record<string, any>, headers: Record<string, string>, body: string, date: string): string {
    const algorithm = 'AWS4-HMAC-SHA256';
    const canonicalUri = this.getCanonicalURI(path);
    const canonicalQueryString = this.getCanonicalQueryString(query);
    const { canonicalHeaders, signedHeaders } = this.getCanonicalHeaders(headers);
    const hashedRequestPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');

    const shortDate = date.substring(0, 8);
    const credentialScope = shortDate + '/' + this.region + '/' + this.service + '/aws4_request';
    const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, date, credentialScope, hashedCanonicalRequest].join('\n');

    const kDate = createHmac('sha256', 'AWS4' + this.SecretAccessKey).update(shortDate).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(this.service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const credential = this.AccessKeyId + '/' + credentialScope;
    return algorithm + ' Credential=' + credential + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  }

  private escape(str: string): string {
    return encodeURIComponent(str)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/%7E/g, '~');
  }

  private getCanonicalURI(path: string): string {
    if (!path) return '/';
    return path.split('/').map((item) => this.escape(item)).join('/');
  }

  private getCanonicalQueryString(parameters: Record<string, any>): string {
    const keys = Object.keys(parameters).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(this.escape(String(key)) + '=' + this.escape(String(parameters[key])));
    }
    return parts.join('&');
  }

  private buildQuery(parameters: Record<string, any>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(encodeURIComponent(String(key)) + '=' + encodeURIComponent(String(value)));
    }
    return parts.join('&');
  }

  private buildForm(params: Record<string, any>): string {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      form.append(k, String(v));
    }
    return form.toString();
  }

  private getCanonicalHeaders(oldheaders: Record<string, string>): { canonicalHeaders: string; signedHeaders: string } {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(oldheaders)) {
      headers[key.toLowerCase()] = String(value).trim();
    }
    const keys = Object.keys(headers).sort();
    let canonicalHeaders = '';
    let signedHeaders = '';
    for (const key of keys) {
      canonicalHeaders += key + ':' + headers[key] + '\n';
      signedHeaders += key + ';';
    }
    signedHeaders = signedHeaders.replace(/;$/, '');
    return { canonicalHeaders, signedHeaders };
  }

  private async curl(method: string, url: string, body: string, headers: Record<string, string>, xml = false, etag = false): Promise<any> {
    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (etag) {
      const match = res.headers.get('etag');
      if (match) this.etag = match;
    }

    const response = await res.text();

    if (res.status >= 200 && res.status < 300) {
      if (!response) return true;
      return xml ? this.xml2array(response) : JSON.parse(response);
    }
    if (xml) {
      const arr = this.xml2array(response);
      if (arr && arr.Error && arr.Error.Message) {
        throw new Error(arr.Error.Message);
      }
      throw new Error('HTTP Code: ' + res.status);
    } else {
      let arr: any = null;
      try {
        arr = JSON.parse(response);
      } catch {
        arr = null;
      }
      if (arr && arr.message) throw new Error(arr.message);
      throw new Error('HTTP Code: ' + res.status);
    }
  }

  private xml2array(xml: string): any {
    if (!xml) return false;
    const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false });
    let doc = parser.parse(xml);
    return this.simplify(doc);
  }

  private simplify(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((v) => this.simplify(v));
    }
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 1 && keys[0] === '#text') {
        return this.simplify(obj['#text']);
      }
      const out: Record<string, any> = {};
      for (const k of keys) {
        out[k] = this.simplify(obj[k]);
      }
      return out;
    }
    return obj;
  }
}
