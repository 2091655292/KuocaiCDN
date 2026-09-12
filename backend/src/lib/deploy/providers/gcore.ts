import type { DeployProvider } from '../types.js';

export class GcoreDeploy implements DeployProvider {
  private url = 'https://api.gcore.com';
  private apikey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.apikey = config.apikey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { Authorization: 'APIKey ' + this.apikey };
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }
    const res = await fetch(url, {
      method: method || (body ? 'POST' : 'GET'),
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
    if (res.status >= 200 && res.status < 300) return result;
    if (result && result.message && result.message.message) throw new Error(result.message.message);
    if (result && result.errors) {
      const firstKey = Object.keys(result.errors)[0];
      const errors = result.errors[firstKey];
      throw new Error(Array.isArray(errors) ? String(errors[0]) : String(errors));
    }
    if (text) this.log('Response:' + text);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.apikey) throw new Error('API令牌不能为空');
    await this.request('/iam/clients/me');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const id = config.id;
    if (!id) throw new Error('证书ID不能为空');

    const params = {
      name: config.name,
      sslCertificate: fullchain,
      sslPrivateKey: privatekey,
      validate_root_ca: true,
    };
    await this.request('/cdn/sslData/' + id, params, 'PUT');
    this.log('证书ID:' + id + '更新成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
