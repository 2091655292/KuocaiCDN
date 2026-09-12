import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class CdnflyDeploy implements DeployProvider {
  private url: string;
  private apiKey: string;
  private apiSecret: string;
  private auth: number;
  private username: string;
  private password: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.apiKey = config.api_key || '';
    this.apiSecret = config.api_secret || '';
    this.auth = config.auth ? Number(config.auth) : 0;
    this.username = this.auth === 1 ? config.username || '' : '';
    this.password = this.auth === 1 ? config.password || '' : '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async login(): Promise<string> {
    const url = this.url + '/v1/login';
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ account: this.username, password: this.password }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('登录失败，返回数据解析失败');
    }
    if (result.code === 0) {
      return result.data.access_token;
    }
    if (result.msg !== undefined) throw new Error(result.msg);
    throw new Error('登录失败，返回数据解析失败');
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { 'api-key': this.apiKey, 'api-secret': this.apiSecret };
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
      throw new Error('返回数据解析失败');
    }
    if (result.code === 0) {
      return result.data ?? null;
    }
    if (result.msg !== undefined) throw new Error(result.msg);
    throw new Error('返回数据解析失败');
  }

  private async authedRequest(path: string, body: string, method: string): Promise<any> {
    const accessToken = await this.login();
    const url = this.url + path;
    const res = await fetch(url, {
      method,
      headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async check(): Promise<void> {
    if (this.auth === 1) {
      if (!this.url || !this.username || !this.password) throw new Error('必填参数不能为空');
      await this.login();
    } else {
      if (!this.url || !this.apiKey || !this.apiSecret) throw new Error('必填参数不能为空');
      await this.request('/v1/user');
    }
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    let id = config.id;
    if (!id) {
      const certInfo = parseCertPem(fullchain);
      if (!certInfo) throw new Error('证书解析失败');
      const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
      const params = {
        type: 'custom',
        name: certName,
        cert: fullchain,
        key: privatekey,
      };
      if (this.auth === 1) {
        const result = await this.authedRequest('/v1/certs', JSON.stringify(params), 'POST');
        if (result && result.code === 0) {
          id = result.data;
        } else if (result && result.msg !== undefined) {
          throw new Error('证书添加失败，' + result.msg);
        } else {
          throw new Error('证书添加失败，返回数据解析失败');
        }
      } else {
        id = await this.request('/v1/certs', params, 'POST');
      }
      this.log('证书ID:' + id + '添加成功！');
      if (!info.config) info.config = {};
      info.config.id = id;
      return;
    }

    const params = {
      type: 'custom',
      cert: fullchain,
      key: privatekey,
    };
    if (this.auth === 1) {
      const result = await this.authedRequest('/v1/certs/' + id, JSON.stringify(params), 'PUT');
      if (result && result.code === 0) {
        // ok
      } else if (result && result.msg !== undefined) {
        throw new Error('证书ID:' + id + '更新失败，' + result.msg);
      } else {
        throw new Error('证书ID:' + id + '更新失败，返回数据解析失败');
      }
    } else {
      await this.request('/v1/certs/' + id, params, 'PUT');
    }
    this.log('证书ID:' + id + '更新成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
