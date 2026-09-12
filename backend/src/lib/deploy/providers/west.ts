import { createHash } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class WestDeploy implements DeployProvider {
  private username: string;
  private api_password: string;
  private baseUrl = 'https://api.west.cn/api/v2';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.api_password = config.api_password || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    if (!this.username || !this.api_password) throw new Error('用户名或API密码不能为空');
    await this.execute('/vhost/', { act: 'products' });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.sitename) throw new Error('FTP账号不能为空');

    let params = { act: 'vhostssl', sitename: config.sitename, cmd: 'info' };
    let data: any;
    try {
      data = await this.execute('/vhost/', params);
    } catch (e: any) {
      throw new Error('获取虚拟主机SSL配置失败:' + e.message);
    }

    params = { act: 'vhostssl', sitename: config.sitename, cmd: 'import', keycontent: privatekey, certcontent: fullchain };
    try {
      await this.execute('/vhost/', params);
    } catch (e: any) {
      throw new Error('上传SSL证书失败:' + e.message);
    }
    this.log('SSL证书上传成功');

    if (data.SSLEnabled === undefined || data.SSLEnabled == 0) {
      params = { act: 'vhostssl', sitename: config.sitename, cmd: 'openssl' };
      try {
        await this.execute('/vhost/', params);
      } catch (e: any) {
        throw new Error('虚拟主机部署SSL失败:' + e.message);
      }
    } else {
      params = { act: 'vhostssl', sitename: config.sitename, cmd: 'info' };
      try {
        data = await this.execute('/vhost/', params);
      } catch (e: any) {
        throw new Error('获取虚拟主机SSL配置失败:' + e.message);
      }
      if (data?.sslcert?.ssl && Object.keys(data.sslcert.ssl).length) {
        for (const domain of Object.keys(data.sslcert.ssl)) {
          if (!config.domainList.includes(domain)) continue;
          params = {
            act: 'vhostssl',
            sitename: config.sitename,
            cmd: 'clearsslcache',
            sslid: data.sslcert.ssl[domain].sysid,
            dm: domain,
          };
          try {
            await this.execute('/vhost/', params);
            this.log('更新' + domain + '证书缓存成功');
          } catch (e: any) {
            this.log('更新' + domain + '证书缓存失败:' + e.message);
          }
        }
      }
    }
    this.log('虚拟主机' + config.sitename + '部署SSL成功');
  }

  private async execute(path: string, params: Record<string, any>): Promise<any> {
    params.username = this.username;
    params.time = String(Date.now());
    params.token = createHash('md5')
      .update(this.username + this.api_password + params.time)
      .digest('hex');

    const body = new URLSearchParams(params as any).toString().replace(/\+/g, '%20');
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const buf = Buffer.from(await res.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder('gbk').decode(buf);
    } catch {
      text = buf.toString('utf8');
    }

    let arr: any = null;
    try {
      arr = text ? JSON.parse(text) : null;
    } catch {
      arr = null;
    }
    if (arr) {
      if (arr.result == 200) return arr.data ?? [];
      throw new Error(arr.msg);
    }
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}