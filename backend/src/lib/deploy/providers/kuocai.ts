import { randomUUID } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class KuocaiDeploy implements DeployProvider {
  private username: string;
  private password: string;
  private token: string | null = null;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.password = config.password || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>, json = false): Promise<any> {
    const url = 'https://www.kuocaicdn.com' + path;
    let body: string | URLSearchParams | undefined;
    const headers: Record<string, string> = {};
    if (params) {
      if (json) {
        body = JSON.stringify(params);
        headers['Content-Type'] = 'application/json';
      } else {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        body = form;
      }
    }
    if (this.token) {
      headers['Cookie'] = 'kuocai_cdn_token=' + this.token;
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
    if (result && result.code === 'SUCCESS') {
      return result.data ?? null;
    }
    if (result && result.message !== undefined) throw new Error(result.message);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  private async login(): Promise<string> {
    return await this.request('/login/loginUser', {
      userAccount: this.username,
      userPwd: this.password,
      remember: 'true',
    });
  }

  async check(): Promise<void> {
    if (!this.username || !this.password) throw new Error('请填写控制台账号和密码');
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const id = config.id;
    if (!id) throw new Error('域名ID不能为空');
    this.token = await this.login();
    await this.request(
      '/CdnDomainHttps/httpsConfiguration',
      {
        doMainId: id,
        https: {
          certificate_name: 'cert_' + randomUUID().substring(0, 8),
          certificate_source: '0',
          certificate_value: fullchain,
          https_status: 'on',
          private_key: privatekey,
        },
      },
      true
    );
    this.log('域名ID:' + id + '更新成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
