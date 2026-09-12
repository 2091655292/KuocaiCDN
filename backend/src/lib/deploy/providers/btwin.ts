import { createHash } from 'node:crypto';
import { buildPfx } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class BtwinDeploy implements DeployProvider {
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

  private async request(path: string, params: Record<string, any>, file = false): Promise<string> {
    const url = this.url + path;
    const nowTime = String(Math.floor(Date.now() / 1000));
    let res: Response;
    if (file) {
      const form = new FormData();
      form.append('request_token', createHash('md5').update(nowTime + createHash('md5').update(this.key).digest('hex')).digest('hex'));
      form.append('request_time', nowTime);
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'object' && v !== null && '__blob' in (v as any)) {
          const item = v as any;
          form.append(k, new Blob([item.__blob]), item.filename || k);
        } else {
          form.append(k, String(v));
        }
      }
      res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    } else {
      const form = new URLSearchParams();
      form.append('request_token', createHash('md5').update(nowTime + createHash('md5').update(this.key).digest('hex')).digest('hex'));
      form.append('request_time', nowTime);
      for (const [k, v] of Object.entries(params)) {
        form.append(k, String(v));
      }
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      });
    }
    return await res.text();
  }

  private async parseResponse(response: string): Promise<any> {
    try {
      return JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
  }

  async check(): Promise<void> {
    if (!this.url || !this.key) throw new Error('请填写面板地址和接口密钥');
    const response = await this.request('/config/get_config', {});
    const result = await this.parseResponse(response);
    if (result.panel && result.panel.status) return;
    throw new Error(result.msg || '面板地址无法连接');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.type === '1') {
      await this.deployPanel(fullchain, privatekey);
      this.log('面板证书部署成功');
      return;
    }

    const isIIS = config.type === '0' && config.is_iis === '1';
    let pfxPath = '';
    if (isIIS) {
      const response = await this.request('/panel/get_config', []);
      const result = await this.parseResponse(response);
      if (result.paths && result.paths.soft) {
        if (result.config.webserver !== 'iis') {
          throw new Error('当前安装的Web服务器不是IIS');
        }
        const panelPath = result.paths.soft;
        const pfxDir = panelPath + '/temp/ssl/' + Date.now();
        pfxPath = pfxDir + '/cert.pfx';
        const pfxPassword = '123456';
        const pfx = buildPfx(fullchain, privatekey, pfxPassword);
        const response2 = await this.request(
          '/files/upload',
          {
            path: pfxDir,
            filename: 'cert.pfx',
            size: pfx.length,
            start: '0',
            blob: { __blob: pfx.toString('binary'), filename: 'cert.pfx' },
            force: 'true',
          },
          true
        );
        const result2 = await this.parseResponse(response2);
        if (!(result2.status)) {
          throw new Error(result2.msg || '面板地址无法连接');
        }
      } else {
        throw new Error(result.msg || '面板地址无法连接');
      }
    }

    const sites = String(config.sites || '').split('\n');
    let success = 0;
    let errmsg: string | null = null;
    for (const site of sites) {
      const siteName = site.trim();
      if (!siteName) continue;
      if (isIIS) {
        try {
          await this.deployIISSite(siteName, pfxPath, '123456');
          this.log('域名 ' + siteName + ' 证书部署成功');
          success++;
        } catch (e: any) {
          errmsg = e.message;
          this.log('域名 ' + siteName + ' 证书部署失败：' + errmsg);
        }
      } else {
        try {
          await this.deploySite(siteName, fullchain, privatekey);
          this.log('网站 ' + siteName + ' 证书部署成功');
          success++;
        } catch (e: any) {
          errmsg = e.message;
          this.log('网站 ' + siteName + ' 证书部署失败：' + errmsg);
        }
      }
    }
    if (success === 0) {
      throw new Error(errmsg || '要部署的网站不存在');
    }
  }

  private async deployPanel(fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/config/set_panel_ssl', {
      ssl_key: privatekey,
      ssl_pem: fullchain,
    });
    const result = await this.parseResponse(response);
    if (result.status) return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  private async deploySite(siteName: string, fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/datalist/get_data_list', {
      table: 'sites',
      search_type: 'PHP',
      search: siteName,
      p: 1,
      limit: 10,
      type: -1,
    });
    const result = await this.parseResponse(response);
    if (result.data !== undefined) {
      if (!result.data || result.data.length === 0) throw new Error('网站 ' + siteName + ' 不存在');
      let siteId: string | null = null;
      for (const item of result.data) {
        if (item.name === siteName) {
          siteId = item.id;
          break;
        }
      }
      if (siteId === null) throw new Error('网站 ' + siteName + ' 不存在');
      const response2 = await this.request('/site/set_site_ssl', {
        siteid: siteId,
        status: 'true',
        sslType: '',
        cert: fullchain,
        key: privatekey,
      });
      const result2 = await this.parseResponse(response2);
      if (result2.status) return;
      if (result2.msg) throw new Error(result2.msg);
      throw new Error(response2 || '返回数据解析失败');
    } else if (result.msg) {
      throw new Error(result.msg);
    } else {
      throw new Error(response || '返回数据解析失败');
    }
  }

  private async deployIISSite(domain: string, pfxPath: string, password = '123456'): Promise<void> {
    const response = await this.request('/site/set_site_domain_ssl', {
      domain,
      path: pfxPath,
      password,
    });
    const result = await this.parseResponse(response);
    if (result.status) return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
