import { createHmac } from 'node:crypto';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class QiniuDeploy implements DeployProvider {
  private AccessKey: string;
  private SecretKey: string;
  private apiUrl = 'https://api.qiniu.com';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKey = config.AccessKey || '';
    this.SecretKey = config.SecretKey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private filterNull(obj: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && v !== undefined) out[k] = v;
    }
    return out;
  }

  private base64UrlSafe(data: Buffer): string {
    return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }

  private async request(
    method: string,
    path: string,
    query: Record<string, any> | null = null,
    params: Record<string, any> | null = null,
  ): Promise<any> {
    let url = this.apiUrl + path;
    let queryStr: string | null = null;
    let body: string | null = null;

    if (query && Object.keys(query).length) {
      const q = this.filterNull(query);
      queryStr = new URLSearchParams(q as any).toString();
      url += '?' + queryStr;
    }
    if (params && Object.keys(params).length) {
      body = JSON.stringify(this.filterNull(params));
    }

    const signStr = path + (queryStr ? '?' + queryStr : '') + '\n';
    const hmac = createHmac('sha1', this.SecretKey).update(signStr).digest();
    const sign = this.AccessKey + ':' + this.base64UrlSafe(hmac);

    const headers: Record<string, string> = { Authorization: 'QBox ' + sign };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { method, headers, body: body || undefined });
    const text = await res.text();
    let arr: any = null;
    try {
      arr = text ? JSON.parse(text) : null;
    } catch {
      arr = null;
    }
    if (res.status === 200) {
      return arr ?? true;
    }
    if (arr && arr.error) throw new Error(String(arr.error));
    throw new Error('返回数据解析失败');
  }

  private async piliRequest(
    method: string,
    path: string,
    query: Record<string, any> | null = null,
    params: Record<string, any> | null = null,
  ): Promise<any> {
    const host = 'pili.qiniuapi.com';
    let url = 'https://' + host + path;
    let queryStr: string | null = null;
    let body: string | null = null;

    if (query && Object.keys(query).length) {
      const q = this.filterNull(query);
      queryStr = new URLSearchParams(q as any).toString();
      url += '?' + queryStr;
    }
    if (params && Object.keys(params).length) {
      body = JSON.stringify(this.filterNull(params));
    }

    const signStr =
      method +
      ' ' +
      path +
      (queryStr ? '?' + queryStr : '') +
      '\nHost: ' +
      host +
      (body ? '\nContent-Type: application/json' : '') +
      '\n\n' +
      (body ?? '');
    const hmac = createHmac('sha1', this.SecretKey).update(signStr).digest();
    const sign = this.AccessKey + ':' + this.base64UrlSafe(hmac);

    const headers: Record<string, string> = { Authorization: 'Qiniu ' + sign };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { method, headers, body: body || undefined });
    const text = await res.text();
    let arr: any = null;
    try {
      arr = text ? JSON.parse(text) : null;
    } catch {
      arr = null;
    }
    if (res.status === 200) {
      return arr ?? true;
    }
    if (arr && arr.error) throw new Error(String(arr.error));
    throw new Error('返回数据解析失败');
  }

  async check(): Promise<void> {
    if (!this.AccessKey || !this.SecretKey) throw new Error('必填参数不能为空');
    await this.request('GET', '/sslcert');
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
    const commonName = certInfo.subject;
    const cert_name = commonName.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const cert_id = await this.getCertId(fullchain, privatekey, commonName, cert_name);
    info.cert_id = cert_id;
    info.cert_name = cert_name;
    if (config.product === 'upload') return;

    for (const domain of String(domains).split(',')) {
      if (!domain) continue;
      if (config.product === 'cdn') {
        await this.deployCdn(domain, cert_id);
      } else if (config.product === 'oss') {
        await this.deployOss(domain, cert_id);
      } else if (config.product === 'pili') {
        await this.deployPili(config.pili_hub, domain, cert_name);
      } else {
        throw new Error('未知的产品类型');
      }
    }
  }

  private async deployCdn(domain: string, cert_id: any): Promise<void> {
    let data: any;
    try {
      data = await this.request('GET', '/domain/' + domain);
    } catch (e: any) {
      throw new Error('获取域名信息失败:' + e.message);
    }
    if (data?.https?.certId == cert_id) {
      this.log('域名 ' + domain + ' 证书已部署，无需重复操作');
      return;
    }

    if (!data?.https?.certId) {
      await this.request('PUT', '/domain/' + domain + '/sslize', null, { certid: cert_id });
    } else {
      await this.request('PUT', '/domain/' + domain + '/httpsconf', null, {
        certid: cert_id,
        forceHttps: data.https.forceHttps,
        http2Enable: data.https.http2Enable,
      });
    }
    this.log('CDN域名 ' + domain + ' 证书部署成功！');
  }

  private async deployOss(domain: string, cert_id: any): Promise<void> {
    await this.request('POST', '/cert/bind', null, { certid: cert_id, domain });
    this.log('OSS域名 ' + domain + ' 证书部署成功！');
  }

  private async deployPili(hub: string, domain: string, cert_name: string): Promise<void> {
    await this.piliRequest('POST', '/v2/hubs/' + hub + '/domains/' + domain + '/cert', null, { CertName: cert_name });
    this.log('视频直播域名 ' + domain + ' 证书部署成功！');
  }

  private async getCertId(fullchain: string, privatekey: string, common_name: string, cert_name: string): Promise<any> {
    let cert_id: any = null;
    let marker = '';
    do {
      const query: Record<string, any> = { marker, limit: 100 };
      const data = await this.request('GET', '/sslcert', query);
      if (!data?.certs) break;
      marker = data.marker ?? '';
      for (const cert of data.certs) {
        if (cert_name === cert.name) {
          cert_id = cert.certid;
          this.log('证书' + cert_name + '已存在，证书ID:' + cert_id);
        } else if (Number(cert.not_after) < Math.floor(Date.now() / 1000)) {
          try {
            await this.request('DELETE', '/sslcert/' + cert.certid);
            this.log('证书' + cert.name + '已过期，删除证书成功');
          } catch (e: any) {
            this.log('证书' + cert.name + '已过期，删除证书失败:' + e.message);
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } while (marker !== '');

    if (!cert_id) {
      const param = { name: cert_name, common_name, pri: privatekey, ca: fullchain };
      let data: any;
      try {
        data = await this.request('POST', '/sslcert', null, param);
      } catch (e: any) {
        throw new Error('上传证书失败:' + e.message);
      }
      this.log('上传证书成功，证书ID:' + data.certID);
      cert_id = data.certID;
      await new Promise((r) => setTimeout(r, 500));
    }
    return cert_id;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}