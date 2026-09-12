import { createHash, createHmac } from 'node:crypto';

export class JdcloudError extends Error {}

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

export class Jdcloud {
  private static algorithm = 'JDCLOUD2-HMAC-SHA256';
  constructor(
    private accessKeyId: string,
    private accessKeySecret: string,
    private endpoint: string,
    private service: string,
    private region: string,
  ) {}

  async request(method: string, path: string, params: Record<string, any> = {}): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) filtered[k] = v;

    let query: Record<string, any> = {};
    let body = '';
    if (method === 'GET' || method === 'DELETE') {
      query = filtered;
    } else {
      body = Object.keys(filtered).length ? JSON.stringify(filtered) : '';
    }

    const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const headers: Record<string, string> = {
      Host: this.endpoint,
      'x-jdcloud-algorithm': Jdcloud.algorithm,
      'x-jdcloud-date': date,
      'x-jdcloud-nonce': Math.random().toString(36).slice(2) + Date.now().toString(36),
    };
    if (body) headers['Content-Type'] = 'application/json';

    headers.authorization = this.sign(method, path, query, headers, body, date);

    let url = 'https://' + this.endpoint + path;
    if (Object.keys(query).length) url += '?' + new URLSearchParams(query).toString();

    const res = await fetch(url, { method, headers, body: body || undefined });
    const json = await res.json();
    if (res.status === 200) {
      if (json.result !== undefined) return json.result;
      return json;
    }
    throw new JdcloudError(json?.error?.message || '返回数据解析失败');
  }

  private sign(method: string, path: string, query: Record<string, any>, headers: Record<string, string>, body: string, date: string): string {
    const canonicalUri = path;
    const qs = canonicalQueryString(query);
    const [ch, signedHeaders] = canonicalHeaders(headers);
    const hashedPayload = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = [method, canonicalUri, qs, ch, signedHeaders, hashedPayload].join('\n');

    const shortDate = date.slice(0, 8);
    const credentialScope = `${shortDate}/${this.region}/${this.service}/jdcloud2_request`;
    const hashedCanonical = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [Jdcloud.algorithm, date, credentialScope, hashedCanonical].join('\n');

    const kDate = createHmac('sha256', 'JDCLOUD2' + this.accessKeySecret).update(shortDate).digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(this.service).digest();
    const kSigning = createHmac('sha256', kService).update('jdcloud2_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${Jdcloud.algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}