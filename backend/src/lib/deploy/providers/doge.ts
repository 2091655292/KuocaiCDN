import { createHmac } from 'node:crypto';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class DogeDeploy implements DeployProvider {
  private AccessKey: string;
  private SecretKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKey = config.AccessKey || '';
    this.SecretKey = config.SecretKey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    if (!this.AccessKey || !this.SecretKey) throw new Error('必填参数不能为空');
    await this.request('/cdn/cert/list.json');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    const domains = config.domain;
    if (!domains) throw new Error('绑定的域名不能为空');

    let certInfo;
    try {
      certInfo = parseCertPem(fullchain);
    } catch {
      throw new Error('证书解析失败');
    }
    const cert_name = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const cert_id = await this.getCertId(fullchain, privatekey, cert_name);

    for (const domain of String(domains).split(',')) {
      if (!domain) continue;
      await this.request('/cdn/cert/bind.json', { id: cert_id, domain });
      this.log('CDN域名 ' + domain + ' 绑定证书成功！');
    }
    info.cert_id = cert_id;
  }

  private async getCertId(fullchain: string, privatekey: string, cert_name: string): Promise<any> {
    let cert_id: any = null;

    const data = await this.request('/cdn/cert/list.json');
    for (const cert of data?.certs || []) {
      if (cert_name === cert.note) {
        cert_id = cert.id;
        this.log('证书' + cert_name + '已存在，证书ID:' + cert_id);
      } else if (Number(cert.expire) < Math.floor(Date.now() / 1000) && cert.domainCount == 0) {
        try {
          await this.request('/cdn/cert/delete.json', { id: cert.id });
          this.log('证书' + cert.name + '已过期，删除证书成功');
        } catch (e: any) {
          this.log('证书' + cert.name + '已过期，删除证书失败:' + e.message);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (!cert_id) {
      const param = { note: cert_name, cert: fullchain, private: privatekey };
      let data2: any;
      try {
        data2 = await this.request('/cdn/cert/upload.json', param);
      } catch (e: any) {
        throw new Error('上传证书失败:' + e.message);
      }
      this.log('上传证书成功，证书ID:' + data2.id);
      cert_id = data2.id;
      await new Promise((r) => setTimeout(r, 500));
    }
    return cert_id;
  }

  private async request(path: string, data: Record<string, any> | null = null, json = false): Promise<any> {
    let body: string | null = null;
    if (data) {
      body = json ? JSON.stringify(data) : new URLSearchParams(data as any).toString();
    }
    const signStr = path + '\n' + (body ?? '');
    const sign = createHmac('sha1', this.SecretKey).update(signStr).digest('hex');
    const authorization = 'TOKEN ' + this.AccessKey + ':' + sign;

    const headers: Record<string, string> = { Authorization: authorization };
    if (body) {
      headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
    }

    const url = 'https://api.dogecloud.com' + path;
    const res = await fetch(url, {
      method: data ? 'POST' : 'GET',
      headers,
      body: body || undefined,
    });
    const text = await res.text();
    let result: any = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }
    if (result && result.code == 200) {
      return result.data ?? true;
    } else if (result && result.msg) {
      throw new Error(result.msg);
    } else {
      throw new Error('请求失败');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}