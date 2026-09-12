import { createHash } from 'node:crypto';

export class Ucloud {
  private apiUrl = 'https://api.ucloud.cn/';
  private publicKey: string;
  private privateKey: string;

  constructor(publicKey: string, privateKey: string) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  async request(action: string, params: Record<string, any>): Promise<any> {
    const param: Record<string, any> = { Action: action, PublicKey: this.publicKey, ...params };
    param.Signature = this.ucloudSignature(param);
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(param),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('返回数据解析失败');
    }
    if (result.RetCode !== undefined && result.RetCode === 0) {
      return result;
    }
    if (result.Message) {
      throw new Error(result.Message);
    }
    throw new Error('返回数据解析失败');
  }

  private ucloudSignature(param: Record<string, any>): string {
    const keys = Object.keys(param).sort();
    let str = '';
    for (const key of keys) {
      str += key + param[key];
    }
    str += this.privateKey;
    return createHash('sha1').update(str).digest('hex');
  }
}