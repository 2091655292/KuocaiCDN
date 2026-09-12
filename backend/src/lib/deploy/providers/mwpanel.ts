import type { DeployProvider } from '../types.js';

export class MwpanelDeploy implements DeployProvider {
  private url: string;
  private appid: string;
  private appsecret: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.appid = config.appid || '';
    this.appsecret = config.appsecret || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>): Promise<string> {
    const url = this.url + path;
    const headers: Record<string, string> = {
      'app-id': this.appid,
      'app-secret': this.appsecret,
    };
    let body: string | undefined;
    if (params) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        form.append(k, String(v));
      }
      body = form.toString();
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
    if (!this.url || !this.appid || !this.appsecret) throw new Error('请填写面板地址和接口密钥');
    const response = await this.request('/task/count');
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error('面板地址无法连接');
    }
    if (result.status === true) return;
    throw new Error(result.msg || '面板地址无法连接');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.type === '1') {
      await this.deployPanel(fullchain, privatekey);
      this.log('面板证书部署成功');
      return;
    }
    const sites = String(config.sites || '').split('\n');
    let success = 0;
    let errmsg: string | null = null;
    for (const site of sites) {
      const siteName = site.trim();
      if (!siteName) continue;
      try {
        await this.deploySite(siteName, fullchain, privatekey);
        this.log('网站 ' + siteName + ' 证书部署成功');
        success++;
      } catch (e: any) {
        errmsg = e.message;
        this.log('网站 ' + siteName + ' 证书部署失败：' + errmsg);
      }
    }
    if (success === 0) {
      throw new Error(errmsg || '要部署的网站不存在');
    }
  }

  private async deployPanel(fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/setting/save_panel_ssl', {
      privateKey: privatekey,
      certPem: fullchain,
      choose: 'local',
    });
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.status === true) return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  private async deploySite(siteName: string, fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/site/set_ssl', {
      type: '1',
      siteName: siteName,
      key: privatekey,
      csr: fullchain,
    });
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.status === true) return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
