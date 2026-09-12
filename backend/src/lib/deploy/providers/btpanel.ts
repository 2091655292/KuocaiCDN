import { createHash } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class BtpanelDeploy implements DeployProvider {
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

  private async request(path: string, params: Record<string, any>): Promise<any> {
    const nowTime = String(Math.floor(Date.now() / 1000));
    const form = new URLSearchParams();
    form.append('request_token', createHash('md5').update(nowTime + createHash('md5').update(this.key).digest('hex')).digest('hex'));
    form.append('request_time', nowTime);
    for (const [k, v] of Object.entries(params)) {
      form.append(k, String(v));
    }
    const res = await fetch(this.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(text || '返回数据解析失败');
    }
    if (result.status) return result;
    if (result.msg) throw new Error(result.msg);
    throw new Error(text || '返回数据解析失败');
  }

  async check(): Promise<void> {
    if (!this.url || !this.key) throw new Error('请填写面板地址和接口密钥');
    const result = await this.request('/config?action=get_config', {});
    if (result.sites_path !== undefined || result.status) return;
    throw new Error('面板地址无法连接');
  }

  private async saveSsl(path: string, data: Record<string, any>): Promise<void> {
    const result = await this.request(path, data);
    if (!result.status && result.msg) throw new Error(result.msg);
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.type === '1') {
      await this.saveSsl('/config?action=SavePanelSSL', { privateKey: privatekey, certPem: fullchain });
      this.log('面板证书部署成功');
      return;
    }

    const sites = String(config.sites || '').split('\n');
    let success = 0;
    let errmsg: string | null = null;
    for (const raw of sites) {
      const siteName = raw.trim();
      if (!siteName) continue;
      try {
        if (config.type === '4') {
          await this.saveSsl('/mod/proxy/com/set_ssl', { site_name: siteName, key: privatekey, csr: fullchain });
          this.log('反向代理站点 ' + siteName + ' 证书部署成功');
        } else if (config.type === '3') {
          await this.saveSsl('/mod/docker/com/set_ssl', { site_name: siteName, key: privatekey, csr: fullchain });
          this.log('Docker域名 ' + siteName + ' 证书部署成功');
        } else if (config.type === '2') {
          await this.saveSsl('/plugin?action=a&name=mail_sys&s=set_mail_certificate_multiple', { domain: siteName, key: privatekey, csr: fullchain, act: 'add' });
          this.log('邮局域名 ' + siteName + ' 证书部署成功');
        } else {
          await this.saveSsl('/site?action=SetSSL', { type: '0', siteName, key: privatekey, csr: fullchain });
          this.log('网站 ' + siteName + ' 证书部署成功');
        }
        success++;
      } catch (e: any) {
        errmsg = e.message;
        this.log('站点 ' + siteName + ' 证书部署失败：' + errmsg);
      }
    }
    if (success === 0) throw new Error(errmsg || '要部署的网站不存在');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}