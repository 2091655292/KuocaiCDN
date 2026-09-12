import { createHash, createHmac } from 'node:crypto';

export class Ksyun {
  private AccessKeyId: string;
  private SecretAccessKey: string;
  private endpoint: string;
  private service: string;
  private region: string;

  constructor(AccessKeyId: string, SecretAccessKey: string, endpoint: string, service: string, region: string) {
    this.AccessKeyId = AccessKeyId;
    this.SecretAccessKey = SecretAccessKey;
    this.endpoint = endpoint;
    this.service = service;
    this.region = region;
  }

  async request(method: 'GET' | 'POST', action: string, version: string, path = '/', params: Record<string, any> = {}): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) filtered[k] = v;
    }

    let body = '';
    let query: Record<string, any> = {};
    if (method === 'GET') {
      query = filtered;
    } else if (Object.keys(filtered).length > 0) {
      body = JSON.stringify(filtered);
    }

    const time = Math.floor(Date.now() / 1000);
    const amzDate = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
    const headers: Record<string, string> = {
      Host: this.endpoint,
      'X-Amz-Date': amzDate,
      'X-Version': version,
      'X-Action': action,
    };

    headers['Authorization'] = this.generateSign(method, path, query, headers, body, time);
    headers['Accept'] = 'application/json';
    if (body) headers['Content-Type'] = 'application/json';

    let url = 'https://' + this.endpoint + path;
    const qs = this.buildQuery(query);
    if (qs) url += '?' + qs;

    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let arr: any;
    try {
      arr = JSON.parse(text);
    } catch {
      arr = null;
    }
    if (res.status === 200) return arr;
    if (arr && arr.Error && arr.Error.Message) throw new Error(arr.Error.Message);
    throw new Error('返回数据解析失败(http_code=' + res.status + ')');
  }

  private generateSign(method: string, path: string, query: Record<string, any>, headers: Record<string, string>, body: string, time: number): string {
    const algorithm = 'AWS4-HMAC-SHA256';
    const httpRequestMethod = method;
    const canonicalUri = this.getCanonicalURI(path);
    const canonicalQueryString = this.getCanonicalQueryString(query);
    const { canonicalHeaders, signedHeaders } = this.getCanonicalHeaders(headers);
    const hashedRequestPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [
      httpRequestMethod,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');

    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
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
      const value = parameters[key];
      if (!Array.isArray(value)) {
        parts.push(this.escape(String(key)) + '=' + this.escape(String(value)));
      } else {
        const sorted = [...value].sort();
        for (const v of sorted) {
          parts.push(this.escape(String(key)) + '=' + this.escape(String(v)));
        }
      }
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
}
