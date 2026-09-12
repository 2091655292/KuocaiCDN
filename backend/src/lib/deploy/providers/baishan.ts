import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class BaishanDeploy implements DeployProvider {
  private url = 'https://cdn.api.baishan.com';
  private token: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.token = config.token || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (result && result.code === 0) return result;
    if (result && result.message !== undefined) throw new Error(result.message);
    if (text) this.log('Response:' + text);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.token) throw new Error('token不能为空');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.id) throw new Error('证书ID不能为空');

    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const params = {
      cert_id: config.id,
      name: certName,
      certificate: fullchain,
      key: privatekey,
    };
    try {
      await this.request('/v2/domain/certificate?token=' + this.token, params);
    } catch (e: any) {
      if (e.message.includes('this certificate is exists')) {
        this.log('证书ID:' + config.id + '已存在，无需更新');
        return;
      }
      throw e;
    }

    this.log('证书ID:' + config.id + '更新成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
