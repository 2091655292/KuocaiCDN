import { createHmac } from 'node:crypto';

export class BaiduCloudError extends Error {}

function escape(str: string): string {
  return encodeURIComponent(str).replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~');
}

function canonicalUri(path: string): string {
  if (!path) return '/';
  let uri = escape(path).replace(/%2F/g, '/');
  if (!uri.startsWith('/')) uri = '/' + uri;
  return uri;
}

function canonicalQueryString(parameters: Record<string, any> | null | undefined): string {
  if (!parameters || !Object.keys(parameters).length) return '';
  const keys = Object.keys(parameters).sort();
  let qs = '';
  for (const key of keys) {
    if (key === 'authorization') continue;
    qs += '&' + escape(key) + '=' + escape(String(parameters[key]));
  }
  return qs.slice(1);
}

function canonicalHeaders(headers: Record<string, string>): [string, string] {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim();
  const keys = Object.keys(lower).sort();
  const canonical = keys.map((k) => `${escape(k)}:${escape(lower[k])}`).join('\n');
  const signed = keys.join(';');
  return [canonical, signed];
}

export class BaiduCloud {
  constructor(private accessKeyId: string, private secretAccessKey: string, private endpoint: string) {}

  async request(method: string, path: string, query?: Record<string, any> | null, params?: Record<string, any> | null): Promise<any> {
    if (query) for (const k of Object.keys(query)) if (query[k] === null || query[k] === undefined) delete query[k];
    if (params) for (const k of Object.keys(params)) if (params[k] === null || params[k] === undefined) delete params[k];

    const time = Math.floor(Date.now() / 1000);
    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = params && Object.keys(params).length ? JSON.stringify(params) : '';

    const headers: Record<string, string> = { Host: this.endpoint, 'x-bce-date': date };
    if (body) headers['Content-Type'] = 'application/json';
    headers.Authorization = this.sign(method, path, query, headers, time);

    let url = 'https://' + this.endpoint + path;
    if (query && Object.keys(query).length) url += '?' + new URLSearchParams(query).toString();

    const res = await fetch(url, { method, headers, body: body || undefined });
    const text = await res.text();
    if (!text && res.status === 200) return true;
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BaiduCloudError('返回数据解析失败');
    }
    if (json.code !== undefined && json.message !== undefined && res.status >= 400) throw new BaiduCloudError(json.message);
    return json;
  }

  private sign(method: string, path: string, query: Record<string, any> | null, headers: Record<string, string>, time: number): string {
    const algorithm = 'bce-auth-v1';
    const uri = canonicalUri(path);
    const qs = canonicalQueryString(query);
    const [ch, signedHeaders] = canonicalHeaders(headers);
    const canonicalRequest = [method, uri, qs, ch].join('\n');

    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expirationInSeconds = 1800;
    const authString = `${algorithm}/${this.accessKeyId}/${date}/${expirationInSeconds}`;
    const signingKey = createHmac('sha256', this.secretAccessKey).update(authString).digest('hex');
    const signature = createHmac('sha256', signingKey).update(canonicalRequest).digest('hex');
    return `${authString}/${signedHeaders}/${signature}`;
  }
}