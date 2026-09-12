import type { DeployProvider } from '../types.js';

export class UusecDeploy implements DeployProvider {
  private url: string;
  private username: string;
  private password: string;
  private accessToken = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.username = config.username || '';
    this.password = config.password || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async login(): Promise<void> {
    const result = await this.request('/api/v1/users/login', {
      usr: this.username,
      pwd: this.password,
      otp: '',
    });
    if (result && result.token) {
      this.accessToken = result.token;
    } else {
      throw new Error('登录失败，' + ((result && result.err) || '未知错误'));
    }
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers['Authorization'] = 'Bearer ' + this.accessToken;
    }
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
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
    if (res.status === 200) return result;
    if (result && result.message !== undefined) throw new Error(result.message);
    throw new Error('请求失败，HTTP状态码：' + res.status);
  }

  async check(): Promise<void> {
    if (!this.url || !this.password || !this.username) throw new Error('用户名和密码不能为空');
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const id = config.id;
    if (!id) throw new Error('证书ID不能为空');

    await this.login();

    const params = {
      id: parseInt(id),
      type: 1,
      name: config.name,
      crt: fullchain,
      key: privatekey,
    };
    const result = await this.request('/api/v1/certs', params, 'PUT');
    if (typeof result === 'string' && result === 'OK') {
      this.log('证书ID:' + id + '更新成功！');
    } else {
      throw new Error('证书ID:' + id + '更新失败，' + ((result && result.err) || '未知错误'));
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
