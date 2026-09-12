import type { DeployProvider } from '../types.js';

export class XpDeploy implements DeployProvider {
  private url: string;
  private apikey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.apikey = config.apikey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>): Promise<string> {
    const url = this.url + path;
    const headers: Record<string, string> = { 'XP-API-KEY': this.apikey };
    let body: string | undefined;
    if (params) {
      body = JSON.stringify(params);
    }
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    return await res.text();
  }

  async check(): Promise<void> {
    if (!this.url || !this.apikey) throw new Error('请填写面板地址和接口密钥');
    const response = await this.request('/openApi/siteList');
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error('面板地址无法连接');
    }
    if (result.code === 1000) return;
    throw new Error(result.message || '面板地址无法连接');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const response = await this.request('/openApi/siteList');
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.code === 1000) {
      const sites = String(config.sites || '').split('\n').map((s) => s.trim());
      let success = 0;
      let errmsg: string | null = null;

      for (const item of result.data || []) {
        if (!sites.includes(item.name)) {
          continue;
        }
        try {
          await this.deploySite(item.id, fullchain, privatekey);
          this.log('网站 ' + item.name + ' 证书部署成功');
          success++;
        } catch (e: any) {
          errmsg = e.message;
          this.log('网站 ' + item.name + ' 证书部署失败：' + errmsg);
        }
      }
      if (success === 0) {
        throw new Error(errmsg || '要部署的网站不存在');
      }
    } else if (result.message) {
      throw new Error(result.message);
    } else {
      throw new Error(response || '返回数据解析失败');
    }
  }

  private async deploySite(id: string | number, fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/openApi/setSSL', {
      id,
      key: privatekey,
      pem: fullchain,
    });
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.code === 1000) return;
    if (result.message) throw new Error(result.message);
    throw new Error(response || '返回数据解析失败');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
