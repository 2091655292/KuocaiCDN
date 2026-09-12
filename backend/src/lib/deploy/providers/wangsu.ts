import { createHmac, createCipheriv, X509Certificate } from 'node:crypto';
import type { DeployProvider } from '../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WangsuDeploy implements DeployProvider {
  private username: string;
  private apiKey: string;
  private spKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.apiKey = config.apiKey || '';
    this.spKey = config.spKey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private encryptPrivateKey(privateKey: string, date: string): string {
    const apiKey = this.spKey || this.apiKey;
    const hmac = createHmac('sha256', apiKey).update(date).digest();
    const aesIvKeyHex = hmac.toString('hex');

    if (aesIvKeyHex.length !== 64) {
      throw new Error('Invalid HMAC length: ' + aesIvKeyHex.length);
    }

    const iv = Buffer.from(aesIvKeyHex.substring(0, 32), 'hex');
    const key = Buffer.from(aesIvKeyHex.substring(32, 64), 'hex');

    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKey)), cipher.final()]);

    return encrypted.toString('base64');
  }

  private async request(
    path: string,
    data: Record<string, any> | null = null,
    json = false,
    date: string | null = null,
    method: string | null = null,
    getLocation = false,
    extraHeaders: Record<string, string> = {}
  ): Promise<any> {
    let body: string | undefined;
    if (data) {
      if (json) {
        body = JSON.stringify(data);
      } else {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(data)) {
          form.append(k, String(v));
        }
        body = form.toString();
      }
    }

    if (!date) {
      date = new Date().toUTCString();
    }

    const hmac = createHmac('sha1', this.apiKey).update(date).digest();
    const signature = hmac.toString('base64');
    const authorization = 'Basic ' + Buffer.from(this.username + ':' + signature).toString('base64');

    const headers: Record<string, string> = {
      Authorization: authorization,
      Date: date,
      Accept: 'application/json',
      Connection: 'close',
      ...extraHeaders,
    };
    if (body && json) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch('https://open.chinanetcenter.com' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let result: any = null;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }

    if (res.status === 201 || (res.status === 200 && getLocation)) {
      const location = res.headers.get('location');
      if (location && location.trim()) {
        return location.trim();
      }
      return true;
    } else if (res.status >= 200 && res.status <= 299) {
      return result ?? true;
    } else if (result && result.message !== undefined) {
      throw new Error(result.message);
    } else if (result && result.result !== undefined) {
      throw new Error(result.result);
    } else {
      throw new Error('请求失败');
    }
  }

  async check(): Promise<void> {
    if (!this.username || !this.apiKey) throw new Error('必填参数不能为空');
    await this.request('/api/ssl/certificate');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product === 'cdnpro') {
      await this.deployCdnpro(fullchain, privatekey, config, info);
    } else if (config.product === 'cdn') {
      await this.deployCdn(fullchain, privatekey, config, info);
    } else if (config.product === 'certificate') {
      const certInfo = parseCertInfo(fullchain);
      const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
      const serialNo = certInfo.serial.toLowerCase();
      await this.getCertId(fullchain, privatekey, certName, config.cert_id, serialNo, true);
    } else if (config.product === 'cdnpro_certificate') {
      await this.deployCdnproCertificate(fullchain, privatekey, config, info);
    } else {
      throw new Error('未知的产品类型');
    }
  }

  private async deployCdn(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.domains) throw new Error('绑定的域名不能为空');
    const domains = String(config.domains).split(',');

    const certInfo = parseCertInfo(fullchain);
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
    const serialNo = certInfo.serial.toLowerCase();
    this.log('证书序列号：' + serialNo);
    let certId = info.cert_id || null;
    certId = await this.getCertId(fullchain, privatekey, certName, certId, serialNo, false);

    try {
      await this.request('/api/config/certificate/batch', { certificateId: certId, domainNames: domains }, true, null, 'PUT');
    } catch (e: any) {
      throw new Error('绑定域名失败：' + e.message);
    }

    this.log('绑定证书成功，证书ID：' + certId);
    info.cert_id = certId;
  }

  private async deployCdnpro(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const domain = config.domain;

    const certInfo = parseCertInfo(fullchain);
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
    const certId = await this.getCertIdCdnpro(fullchain, privatekey, certName);

    let hostnameInfo: any;
    try {
      hostnameInfo = await this.request('/cdn/hostnames/' + domain);
    } catch (e: any) {
      throw new Error('获取域名信息失败：' + e.message);
    }

    if (!hostnameInfo.propertyInProduction) {
      throw new Error('域名 ' + domain + ' 不存在或未部署到生产环境');
    } else {
      this.log('CDN域名 ' + domain + ' 对应的加速项目ID：' + hostnameInfo.propertyInProduction.propertyId);
      this.log('CDN域名 ' + domain + ' 对应的加速项目生产版本：' + hostnameInfo.propertyInProduction.version);
    }

    if (hostnameInfo.propertyInProduction.certificateId === certId) {
      this.log('CDN域名 ' + domain + ' 已绑定证书：' + certName);
      return;
    }

    let properity: any;
    try {
      properity = await this.request('/cdn/properties/' + hostnameInfo.propertyInProduction.propertyId + '/versions/' + hostnameInfo.propertyInProduction.version);
    } catch (e: any) {
      throw new Error('获取加速项目版本信息失败：' + e.message);
    }

    const properityConfig = properity.configs;
    properityConfig.tlsCertificateId = certId;

    let data: any;
    try {
      data = await this.request('/cdn/properties/' + hostnameInfo.propertyInProduction.propertyId + '/versions', properityConfig, true);
    } catch (e: any) {
      throw new Error('新增加速项目版本失败：' + e.message);
    }

    const newVersion = this.lastPathSegment(data);
    if (!newVersion) throw new Error('新增加速项目版本返回数据异常');

    try {
      data = await this.request('/cdn/validations', {
        propertyId: hostnameInfo.propertyInProduction.propertyId,
        version: parseInt(newVersion),
      }, true);
    } catch (e: any) {
      throw new Error('发起加速项目验证失败：' + e.message);
    }

    const validationTaskId = this.lastPathSegment(data);
    if (!validationTaskId) throw new Error('验证任务ID获取失败');
    this.log('验证任务ID：' + validationTaskId);

    const maxAttempts = 12;
    let status: string | null = null;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      await sleep(5000);
      try {
        data = await this.request('/cdn/validations/' + validationTaskId);
      } catch (e: any) {
        throw new Error('获取验证任务状态失败：' + e.message);
      }
      status = data.status;
      if (status === 'failed') {
        throw new Error('证书绑定失败，加速项目验证失败');
      }
      if (status === 'succeeded') {
        break;
      }
    }
    if (status !== 'succeeded') {
      throw new Error('证书绑定超时，加速项目验证时间过长');
    }

    this.log('加速项目验证成功，开始部署...');

    const deploymentTasks = {
      target: 'production',
      actions: [
        { action: 'deploy_cert', certificateId: certId, version: 1 },
        { action: 'deploy_property', propertyId: hostnameInfo.propertyInProduction.propertyId, version: parseInt(newVersion) },
      ],
      name: 'Deploy certificate and property for ' + hostnameInfo.propertyInProduction.propertyId,
    };

    try {
      data = await this.request('/cdn/deploymentTasks', deploymentTasks, true, null, 'POST', false, {
        'Check-Certificate': 'no',
        'Check-Usage': 'no',
      });
    } catch (e: any) {
      throw new Error('下发证书部署任务失败：' + e.message);
    }

    const deploymentTaskId = this.lastPathSegment(data);
    this.log('CDN域名 ' + domain + ' 绑定证书部署任务下发成功，部署任务ID：' + deploymentTaskId);
    info.cert_id = certId;
  }

  private async deployCdnproCertificate(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    const certInfo = parseCertInfo(fullchain);
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
    const certId = config.cert_id;
    if (!certId) throw new Error('证书ID不能为空');

    const result = await this.updateCertIdCdnpro(fullchain, privatekey, certName, certId);

    if (!result.updated) {
      info.cert_id = result.cert_id;
      return;
    }

    const deploymentTasks = {
      target: 'production',
      actions: [{ action: 'deploy_cert', certificateId: result.cert_id, version: parseInt(result.version) }],
      name: 'Deploy certificate ' + certName,
    };

    let data: any;
    try {
      data = await this.request('/cdn/deploymentTasks', deploymentTasks, true, null, 'POST', false, {
        'Check-Certificate': 'no',
        'Check-Usage': 'no',
      });
    } catch (e: any) {
      throw new Error('下发证书部署任务失败：' + e.message);
    }

    const deploymentTaskId = this.lastPathSegment(data);
    this.log('证书部署任务下发成功，部署任务ID：' + deploymentTaskId);
    info.cert_id = result.cert_id;
  }

  private lastPathSegment(data: any): string {
    if (typeof data !== 'string') return '';
    try {
      const path = new URL(data).pathname;
      const parts = path.split('/').filter((s) => s.length > 0);
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  }

  private async getCertId(fullchain: string, privatekey: string, certName: string, certId: string | null | undefined, serialNo: string, overwrite: boolean): Promise<string> {
    if (certId) {
      let data: any;
      try {
        data = await this.request('/api/certificate/' + certId);
      } catch (e: any) {
        throw new Error('获取证书详情失败：' + e.message);
      }

      if (data.message === 'success' && data.data.name === certName && data.data.serial === serialNo) {
        this.log('证书已是最新，证书ID：' + certId);
        return certId;
      }

      this.log('证书已过期或被删除，准备重新上传');
    } else if (overwrite) {
      throw new Error('证书ID不能为空');
    }

    if (overwrite) {
      const param = { name: certName, certificate: fullchain, privateKey: privatekey };
      try {
        await this.request('/api/certificate/' + certId, param, true, null, 'PUT');
        this.log('更新证书成功，证书ID：' + certId);
        return certId as string;
      } catch (e: any) {
        throw new Error('更新证书失败：' + e.message);
      }
    }

    let data: any;
    try {
      data = await this.request('/api/ssl/certificate');
    } catch (e: any) {
      throw new Error('获取证书列表失败：' + e.message);
    }

    const certificates = data['ssl-certificate'] || [];
    if (certificates.length > 0) {
      for (const cert of certificates) {
        if (serialNo === cert['certificate-serial']) {
          const newId = cert['certificate-id'];
          this.log('证书' + certName + '已存在，新证书ID：' + newId);
          try {
            await this.request('/api/certificate/' + newId, { name: certName }, true, null, 'PUT');
          } catch (e: any) {
            throw new Error('证书更名失败：' + e.message);
          }
          this.log('将证书ID为' + newId + '的证书更名为：' + certName);
          return newId;
        } else if (certName === cert.name) {
          this.log('证书' + certName + '已存在，但序列号（' + cert['certificate-id'] + '）不匹配，准备重新上传');
          try {
            await this.request('/api/certificate/' + cert['certificate-id'], { name: certName + '-bak' }, true, null, 'PUT');
          } catch (e: any) {
            throw new Error('证书更名失败：' + e.message);
          }
          this.log('将证书ID为' + cert['certificate-id'] + '的证书更名为：' + certName + '-bak');
        }
      }
    }

    const param = { name: certName, certificate: fullchain, privateKey: privatekey };
    let result: any;
    try {
      result = await this.request('/api/certificate', param, true, null, 'POST', true);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }

    const newId = this.lastPathSegment(result);
    this.log('上传证书成功，证书ID：' + newId);
    return newId;
  }

  private async getCertIdCdnpro(fullchain: string, privatekey: string, certName: string): Promise<string> {
    let data: any;
    try {
      data = await this.request('/cdn/certificates?search=' + encodeURIComponent(certName));
    } catch (e: any) {
      throw new Error('获取证书列表失败：' + e.message);
    }

    if (data.count > 0) {
      for (const cert of data.certificates || []) {
        if (certName === cert.name) {
          this.log('证书' + certName + '已存在，证书ID：' + cert.certificateId);
          return cert.certificateId;
        }
      }
    }

    const date = new Date().toUTCString();
    const encryptedKey = this.encryptPrivateKey(privatekey, date);
    const param = {
      name: certName,
      autoRenew: 'Off',
      newVersion: {
        privateKey: encryptedKey,
        certificate: fullchain,
      },
    };

    try {
      data = await this.request('/cdn/certificates', param, true, date);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }

    const certId = this.lastPathSegment(data);
    this.log('上传证书成功，证书ID：' + certId);

    await sleep(500);

    return certId;
  }

  private async updateCertIdCdnpro(fullchain: string, privatekey: string, certName: string, certId: string): Promise<{ cert_id: string; updated: boolean; version?: number }> {
    let data: any;
    try {
      data = await this.request('/cdn/certificates/' + certId);
    } catch (e: any) {
      throw new Error('证书ID ' + certId + ' 不存在或获取失败：' + e.message);
    }

    if (data.name === certName) {
      this.log('证书已是最新，无需更新，证书ID：' + certId);
      return { cert_id: certId, updated: false };
    }

    this.log('证书已过期，准备更新...');

    const date = new Date().toUTCString();
    const encryptedKey = this.encryptPrivateKey(privatekey, date);
    const param = {
      name: certName,
      newVersion: {
        privateKey: encryptedKey,
        certificate: fullchain,
        comments: certName,
      },
    };

    let location: any;
    try {
      location = await this.request('/cdn/certificates/' + certId, param, true, date, 'PATCH', true);
    } catch (e: any) {
      throw new Error('更新证书失败：' + e.message);
    }

    let version = 1;
    if (typeof location === 'string') {
      const last = this.lastPathSegment(location);
      if (last && !isNaN(parseInt(last))) version = parseInt(last);
    }

    this.log('更新证书成功，证书ID：' + certId + '，版本号：' + version);
    return { cert_id: certId, version, updated: true };
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}

function parseCertInfo(fullchain: string) {
  const x = new X509Certificate(fullchain);
  const extractCN = (s: string) => {
    const m = s.match(/CN=([^,\n]+)/);
    return m ? m[1].trim() : '';
  };
  return {
    subject: extractCN(x.subject),
    issuer: extractCN(x.issuer),
    validFrom: new Date(x.validFrom).getTime() / 1000,
    validTo: new Date(x.validTo).getTime() / 1000,
    serial: x.serialNumber.toLowerCase(),
  };
}