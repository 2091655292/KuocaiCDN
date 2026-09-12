import { createHash, createHmac, randomBytes } from 'node:crypto';

export class AliyunNew {
  private AccessKeyId: string;
  private AccessKeySecret: string;
  private Endpoint: string;
  private Version: string;

  constructor(AccessKeyId: string, AccessKeySecret: string, Endpoint: string, Version: string) {
    this.AccessKeyId = AccessKeyId;
    this.AccessKeySecret = AccessKeySecret;
    this.Endpoint = Endpoint;
    this.Version = Version;
  }

  async request(method: string, action: string, path = '/', params: Record<string, any> | null = null): Promise<any> {
    const filtered: Record<string, any> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) filtered[k] = v;
      }
    }

    let query: Record<string, any> = {};
    let body = '';
    if (method === 'GET' || method === 'DELETE') {
      query = filtered;
    } else {
      if (Object.keys(filtered).length > 0) body = JSON.stringify(filtered);
    }

    const headers: Record<string, string> = {
      'x-acs-action': action,
      'x-acs-version': this.Version,
      'x-acs-signature-nonce': createHash('md5').update(randomBytes(16)).digest('hex'),
      'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      'x-acs-content-sha256': createHash('sha256').update(body).digest('hex'),
      Host: this.Endpoint,
    };
    if (body) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    headers['Authorization'] = this.generateSign(method, path, query, headers, body);

    let url = 'https://' + this.Endpoint + path;
    const qs = this.buildQuery(query);
    if (qs) url += '?' + qs;

    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let arr: any = null;
    try {
      arr = JSON.parse(text);
    } catch {
      arr = null;
    }
    if (res.status === 200) return arr;
    if (arr) {
      let msg = arr.Message || '';
      if (msg.includes('.')) msg = msg.substring(0, msg.indexOf('.') + 1);
      throw new Error(msg);
    }
    throw new Error('返回数据解析失败');
  }

  private generateSign(method: string, path: string, query: Record<string, any>, headers: Record<string, string>, body: string): string {
    const algorithm = 'ACS3-HMAC-SHA256';
    const canonicalUri = this.getCanonicalURI(path);
    const canonicalQueryString = this.getCanonicalQueryString(query);
    const { canonicalHeaders, signedHeaders } = this.getCanonicalHeaders(headers);
    const hashedRequestPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, hashedRequestPayload].join('\n');

    const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = algorithm + '\n' + hashedCanonicalRequest;
    const signature = createHmac('sha256', this.AccessKeySecret).update(stringToSign).digest('hex');

    return algorithm + ' Credential=' + this.AccessKeyId + ',SignedHeaders=' + signedHeaders + ',Signature=' + signature;
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