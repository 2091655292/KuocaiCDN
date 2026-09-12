import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class LecdnDeploy implements DeployProvider {
  private url: string;
  private email: string;
  private password: string;
  private auth: number;
  private apiKey: string;
  private accessToken = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.email = config.email || '';
    this.password = config.password || '';
    this.auth = parseInt(config.auth) || 0;
    this.apiKey = this.auth === 1 ? config.api_key || '' : '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async login(): Promise<void> {
    const result = await this.request('/prod-api/login', {
      email: this.email,
      username: this.email,
      password: this.password,
    });
    if (result && result.token) {
      this.accessToken = result.token;
    } else {
      throw new Error('登录成功，获取access_token失败');
    }
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers['Authorization'] = 'Bearer ' + this.accessToken;
    } else if (this.auth === 1 && this.apiKey) {
      headers['Authorization'] = this.apiKey;
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
    if (result && result.code === 200) {
      return result.data ?? null;
    }
    if (result && result.message !== undefined) throw new Error(result.message);
    throw new Error('返回数据解析失败');
  }

  async check(): Promise<void> {
    if (this.auth === 1) {
      if (!this.url || !this.apiKey) throw new Error('API访问令牌不能为空');
      await this.request('/prod-api/system/info');
    } else {
      if (!this.url || !this.email || !this.password) throw new Error('账号和密码不能为空');
      await this.login();
    }
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (this.auth === 0) {
      await this.login();
    }

    let id = config.id;
    if (!id) {
      const certInfo = parseCertPem(fullchain);
      if (!certInfo) throw new Error('证书解析失败');
      const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
      const params = {
        name: certName,
        type: 'upload',
        ssl_pem: Buffer.from(fullchain).toString('base64'),
        ssl_key: Buffer.from(privatekey).toString('base64'),
        auto_renewal: false,
      };
      const data = await this.request('/prod-api/certificate', params, 'POST');
      id = data.id;
      this.log('证书ID:' + id + '添加成功！');
      if (!info.config) info.config = {};
      info.config.id = id;
      return;
    }

    let data: any;
    try {
      data = await this.request('/prod-api/certificate/' + id);
    } catch (e: any) {
      throw new Error('证书ID:' + id + '获取失败：' + e.message);
    }

    const params = {
      id: parseInt(id),
      name: data.name,
      description: data.description,
      type: 'upload',
      ssl_pem: Buffer.from(fullchain).toString('base64'),
      ssl_key: Buffer.from(privatekey).toString('base64'),
      auto_renewal: false,
    };
    await this.request('/prod-api/certificate/' + id, params, 'PUT');
    this.log('证书ID:' + id + '更新成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
