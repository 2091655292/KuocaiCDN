import { createHash, createHmac } from 'node:crypto';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function hmacSha256(key: string | Buffer, msg: string): Buffer {
  return createHmac('sha256', key).update(msg).digest();
}

export class TencentCloudError extends Error {}

export class TencentCloud {
  constructor(
    private secretId: string,
    private secretKey: string,
    private endpoint: string,
    private service: string,
    private version: string,
    private region?: string,
  ) {}

  async request(action: string, param: Record<string, any>): Promise<any> {
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(param)) {
      if (v !== null && v !== undefined) filtered[k] = v;
    }
    const payload = JSON.stringify(filtered);
    const time = Math.floor(Date.now() / 1000);
    const authorization = this.sign(payload, time);
    const headers: Record<string, string> = {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Timestamp': String(time),
      'X-TC-Version': this.version,
    };
    if (this.region) headers['X-TC-Region'] = this.region;

    const res = await fetch('https://' + this.endpoint + '/', {
      method: 'POST',
      headers,
      body: payload,
    });
    const json = await res.json();
    if (json.Response?.Error) {
      throw new TencentCloudError(json.Response.Error.Message);
    }
    return json.Response;
  }

  private sign(payload: string, time: number): string {
    const algorithm = 'TC3-HMAC-SHA256';
    const date = new Date(time * 1000).toISOString().slice(0, 10);
    const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + this.endpoint + '\n';
    const signedHeaders = 'content-type;host';
    const hashedPayload = sha256Hex(payload);
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const hashedCanonical = sha256Hex(canonicalRequest);
    const stringToSign = [algorithm, String(time), credentialScope, hashedCanonical].join('\n');
    const secretDate = hmacSha256('TC3' + this.secretKey, date);
    const secretService = hmacSha256(secretDate, this.service);
    const secretSigning = hmacSha256(secretService, 'tc3_request');
    const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
    return `${algorithm} Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}