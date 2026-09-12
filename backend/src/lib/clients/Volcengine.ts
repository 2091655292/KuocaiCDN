import { createHash, createHmac } from 'node:crypto';

export class VolcengineError extends Error {}

function escape(str: string): string {
  return encodeURIComponent(str).replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~');
}

function canonicalQueryString(parameters: Record<string, any>): string {
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

export class Volcengine {
  constructor(
    private accessKeyId: string,
    private secretAccessKey: string,
    private endpoint: string,
    private service: string,
    private version: string,
    private region: string,
  ) {}

  async request(method: string, action: string, params: Record<string, any> = {}, querys: Record<string, any> = {}): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) filtered[k] = v;

    const query: Record<string, string> = { Action: action, Version: this.version };
    let body = '';
    if (method === 'GET') {
      for (const [k, v] of Object.entries(filtered)) query[k] = String(v);
    } else {
      body = Object.keys(filtered).length ? JSON.stringify(filtered) : '';
      for (const [k, v] of Object.entries(querys)) query[k] = String(v);
    }

    const time = Math.floor(Date.now() / 1000);
    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const headers: Record<string, string> = { Host: this.endpoint, 'X-Date': date };
    if (body) headers['Content-Type'] = 'application/json';

    headers.Authorization = this.sign(method, '/', query, headers, body, time);

    const url = 'https://' + this.endpoint + '/?' + new URLSearchParams(query).toString();
    const res = await fetch(url, { method, headers, body: body || undefined });
    const json = await res.json();
    if (res.status === 200) {
      const err = json?.ResponseMetadata?.Error;
      if (err) throw new VolcengineError(err.Message || err.MessageCN);
      if (json.Result !== undefined) return json.Result;
      return true;
    }
    throw new VolcengineError(json?.message || json?.Message || '返回数据解析失败');
  }

  private sign(method: string, path: string, query: Record<string, string>, headers: Record<string, string>, body: string, time: number): string {
    const algorithm = 'HMAC-SHA256';
    let uri = path;
    if (!uri.endsWith('/')) uri += '/';
    const qs = canonicalQueryString(query);
    const [ch, signedHeaders] = canonicalHeaders(headers);
    const hashedPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [method, uri, qs, ch, signedHeaders, hashedPayload].join('\n');

    const date = new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const shortDate = date.slice(0, 8);
    const credentialScope = `${shortDate}/${this.region}/${this.service}/request`;
    const hashedCanonical = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, date, credentialScope, hashedCanonical].join('\n');

    const kDate = createHmac('sha256', this.secretAccessKey).update(shortDate).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(this.service).digest();
    const kSigning = createHmac('sha256', kService).update('request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}