import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class GoedgeDeploy implements DeployProvider {
  private url: string;
  private accessKeyId: string;
  private accessKey: string;
  private usertype: string;
  private systype: string;
  private accessToken = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.accessKeyId = config.accessKeyId || '';
    this.accessKey = config.accessKey || '';
    this.usertype = config.usertype || '';
    this.systype = config.systype || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async getAccessToken(): Promise<void> {
    const result = await this.request('/APIAccessTokenService/getAPIAccessToken', {
      type: this.usertype,
      accessKeyId: this.accessKeyId,
      accessKey: this.accessKey,
    });
    if (result && result.token) {
      this.accessToken = result.token;
    } else {
      throw new Error('登录成功，获取AccessToken失败');
    }
  }

  private async request(path: string, params?: Record<string, any>): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      if (this.systype === '1') {
        headers['X-Cloud-Access-Token'] = this.accessToken;
      } else {
        headers['X-Edge-Access-Token'] = this.accessToken;
      }
    }
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
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
    if (result && result.code === 200) {
      return result.data ?? null;
    }
    if (result && result.message !== undefined) throw new Error(result.message);
    if (text) this.log('Response:' + text);
    throw new Error('返回数据解析失败');
  }

  async check(): Promise<void> {
    if (!this.url || !this.accessKeyId || !this.accessKey) throw new Error('必填参数不能为空');
    await this.getAccessToken();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const domains: string[] = config.domainList;
    if (!domains || domains.length === 0) throw new Error('没有设置要部署的域名');

    await this.getAccessToken();

    let data: any;
    try {
      data = await this.request('/SSLCertService/listSSLCerts', { domains, offset: 0, size: 10 });
    } catch (e: any) {
      throw new Error('获取证书列表失败：' + e.message);
    }
    const list = JSON.parse(Buffer.from(data.sslCertsJSON, 'base64').toString());
    this.log('获取证书列表成功(total=' + list.length + ')');

    const certInfo = parseCertPem(fullchain);
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    if (list && list.length > 0) {
      for (const row of list) {
        const params = {
          sslCertId: row.id,
          isOn: true,
          name: row.name,
          description: row.description,
          serverName: row.serverName,
          isCA: false,
          certData: Buffer.from(fullchain).toString('base64'),
          keyData: Buffer.from(privatekey).toString('base64'),
          timeBeginAt: Math.floor(certInfo.validFrom),
          timeEndAt: Math.floor(certInfo.validTo),
          dnsNames: domains,
          commonNames: [certInfo.issuer],
        };
        await this.request('/SSLCertService/updateSSLCert', params);
        this.log('证书ID:' + row.id + '更新成功！');
      }
    } else {
      const params = {
        isOn: true,
        name: certName,
        description: certName,
        serverName: certInfo.subject,
        isCA: false,
        certData: Buffer.from(fullchain).toString('base64'),
        keyData: Buffer.from(privatekey).toString('base64'),
        timeBeginAt: Math.floor(certInfo.validFrom),
        timeEndAt: Math.floor(certInfo.validTo),
        dnsNames: domains,
        commonNames: [certInfo.issuer],
      };
      const result = await this.request('/SSLCertService/createSSLCert', params);
      this.log('证书ID:' + result.sslCertId + '添加成功！');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
