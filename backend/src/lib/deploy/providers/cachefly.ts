import type { DeployProvider } from '../types.js';

export class CacheflyDeploy implements DeployProvider {
  private url = 'https://api.cachefly.com/api/2.5';
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
    const headers: Record<string, string> = { 'x-cf-authorization': 'Bearer ' + this.apikey };
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
    if (text) this.log('Response:' + text);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.apikey) throw new Error('API令牌不能为空');
    await this.request('/accounts/me');
  }

  async deploy(fullchain: string, privatekey: string, _config: Record<string, any>, _info: any): Promise<void> {
    const params = {
      certificate: fullchain,
      certificateKey: privatekey,
    };
    await this.request('/certificates', params);
    this.log('证书上传成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
