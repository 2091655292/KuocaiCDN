import { createHash } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class BtwafDeploy implements DeployProvider {
  private url: string;
  private key: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.key = config.key || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params: Record<string, any>): Promise<string> {
    const url = this.url + path;
    const nowTime = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      waf_request_time: nowTime,
      waf_request_token: createHash('md5').update(nowTime + createHash('md5').update(this.key).digest('hex')).digest('hex'),
      'Content-Type': 'application/json',
    };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(15000),
    });
    return await res.text();
  }

  async check(): Promise<void> {
    if (!this.url || !this.key) throw new Error('请填写面板地址和接口密钥');
    const response = await this.request('/api/user/latest_version', {});
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error('面板地址无法连接');
    }
    if (result.code === 0) return;
    throw new Error(result.res || '面板地址无法连接');
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

  private async parseResponse(response: string): Promise<any> {
    try {
      return JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
  }

  private async deploySite(siteName: string, fullchain: string, privatekey: string): Promise<void> {
    let siteId: string | null = null;
    let listenSslPort: string[] = ['443'];
    const response = await this.request('/api/wafmastersite/get_site_list', { p: 1, p_size: 10, site_name: siteName });
    const result = await this.parseResponse(response);
    if (result.code === 0) {
      for (const site of result.res.list || []) {
        if (site.site_name === siteName) {
          siteId = site.site_id;
          if (site.server && site.server.listen_ssl_port && site.server.listen_ssl_port.length > 0) {
            listenSslPort = site.server.listen_ssl_port;
          }
          break;
        }
      }
      if (!siteId) {
        throw new Error('网站名称不存在');
      }
    } else if (result.res !== undefined) {
      throw new Error(result.res);
    } else {
      throw new Error(response || '返回数据解析失败');
    }
    const response2 = await this.request('/api/wafmastersite/modify_site', {
      types: 'openCert',
      site_id: siteId,
      server: {
        listen_ssl_port: listenSslPort,
        ssl: {
          is_ssl: 1,
          private_key: privatekey,
          full_chain: fullchain,
        },
      },
    });
    const result2 = await this.parseResponse(response2);
    if (result2.code === 0) return;
    if (result2.res !== undefined) throw new Error(result2.res);
    throw new Error(response2 || '返回数据解析失败');
  }

  private async deployPanel(fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/api/config/set_cert', {
      certContent: fullchain,
      keyContent: privatekey,
    });
    const result = await this.parseResponse(response);
    if (result.code === 0) return;
    if (result.res !== undefined) throw new Error(result.res);
    throw new Error(response || '返回数据解析失败');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
