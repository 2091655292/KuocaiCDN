import { createHmac } from 'node:crypto';

function percentEncode(str: string): string {
  const encoded = encodeURIComponent(str);
  return encoded.replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~');
}

export class AliyunError extends Error {}

export class Aliyun {
  constructor(
    private accessKeyId: string,
    private accessKeySecret: string,
    private endpoint: string,
    private version: string,
  ) {}

  async request(param: Record<string, any>, method: 'GET' | 'POST' = 'POST'): Promise<any> {
    const data: Record<string, string> = {
      Format: 'JSON',
      Version: this.version,
      AccessKeyId: this.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      SignatureVersion: '1.0',
      SignatureNonce: Math.random().toString(36).slice(2, 18),
    };
    for (const [k, v] of Object.entries(param)) {
      if (v === null || v === undefined) continue;
      data[k] = String(v);
    }
    data.Signature = this.sign(data, method);

    const url = 'https://' + this.endpoint + '/';
    const body = new URLSearchParams(data).toString();
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? body : undefined,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AliyunError('返回数据解析失败');
    }
    if (res.status === 200 && !(json as any).Code) {
      return json;
    }
    if (json && (json.Code || json.Message)) {
      throw new AliyunError(json.Message || json.Code);
    }
    throw new AliyunError('返回数据解析失败');
  }

  private sign(parameters: Record<string, string>, method: string): string {
    const keys = Object.keys(parameters).sort();
    let canonical = '';
    for (const key of keys) {
      canonical += '&' + percentEncode(key) + '=' + percentEncode(parameters[key]);
    }
    const stringToSign = method + '&%2F&' + percentEncode(canonical.slice(1));
    const signature = createHmac('sha1', this.accessKeySecret + '&').update(stringToSign).digest('base64');
    return signature;
  }
}