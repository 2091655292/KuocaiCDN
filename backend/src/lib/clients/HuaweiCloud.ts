import { createHash, createHmac } from 'node:crypto';

export class HuaweiCloudError extends Error {}

function escape(str: string): string {
  return encodeURIComponent(str).replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~');
}

function canonicalUri(path: string): string {
  if (!path) return '/';
  const segments = path.split('/').map((item) => escape(item));
  let uri = segments.join('/');
  if (!uri.endsWith('/')) uri += '/';
  return uri;
}

function canonicalQueryString(parameters: Record<string, any> | null | undefined): string {
  if (!parameters || !Object.keys(parameters).length) return '';
  const keys = Object.keys(parameters).sort();
  let qs = '';
  for (const key of keys) {
    if (parameters[key] === null || parameters[key] === undefined) continue;
    qs += '&' + escape(key) + '=' + escape(String(parameters[key]));
  }
  return qs.slice(1);
}

function canonicalHeaders(headers: Record<string, string>): [string, string] {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim();
  const keys = Object.keys(lower).sort();
  const canonical = keys.map((k) => `${k}:${lower[k]}`).join('\n') + '\n';
  const signed = keys.join(';');
  return [canonical, signed];
}

export class HuaweiCloud {
  constructor(private accessKeyId: string, private secretAccessKey: string, private endpoint: string) {}

  async request(method: string, path: string, query?: Record<string, any> | null, params?: Record<string, any> | null): Promise<any> {
    if (query) for (const k of Object.keys(query)) if (query[k] === null || query[k] === undefined) delete query[k];
    if (params) for (const k of Object.keys(params)) if (params[k] === null || params[k] === undefined) delete params[k];

    const time = Math.floor(Date.now() / 1000);
    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = params && Object.keys(params).length ? JSON.stringify(params) : '';

    const headers: Record<string, string> = { Host: this.endpoint, 'X-Sdk-Date': date };
    if (body) headers['Content-Type'] = 'application/json';
    headers.Authorization = this.sign(method, path, query, headers, body, time);

    let url = 'https://' + this.endpoint + path;
    if (query && Object.keys(query).length) url += '?' + new URLSearchParams(query).toString();

    const res = await fetch(url, { method, headers, body: body || undefined });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (json) {
      if (json.error_msg) throw new HuaweiCloudError(json.error_msg);
      if (json.message) throw new HuaweiCloudError(json.message);
      if (json.error?.error_msg) throw new HuaweiCloudError(json.error.error_msg);
      return json;
    }
    if (res.status >= 200 && res.status < 300) return null;
    throw new HuaweiCloudError('返回数据解析失败');
  }

  private sign(method: string, path: string, query: Record<string, any> | null, headers: Record<string, string>, body: string, time: number): string {
    const algorithm = 'SDK-HMAC-SHA256';
    const uri = canonicalUri(path);
    const qs = canonicalQueryString(query);
    const [ch, signedHeaders] = canonicalHeaders(headers);
    const hashedPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [method, uri, qs, ch, signedHeaders, hashedPayload].join('\n');
    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hashedCanonical = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, date, hashedCanonical].join('\n');
    const signature = createHmac('sha256', this.secretAccessKey).update(stringToSign).digest('hex');
    return `${algorithm} Access=${this.accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}