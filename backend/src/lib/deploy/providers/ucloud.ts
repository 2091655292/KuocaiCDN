import { Ucloud } from '../../clients/Ucloud.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class UcloudDeploy implements DeployProvider {
  private PublicKey: string;
  private PrivateKey: string;
  private client: Ucloud;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.PublicKey = config.PublicKey || '';
    this.PrivateKey = config.PrivateKey || '';
    this.client = new Ucloud(this.PublicKey, this.PrivateKey);
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    if (!this.PublicKey || !this.PrivateKey) throw new Error('必填参数不能为空');
    await this.client.request('GetCertificateList', { Mode: 'free' });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    const domainId = config.domain_id;
    if (!domainId) throw new Error('云分发资源ID不能为空');

    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*').join('').split('.').join('') + '-' + Math.floor(certInfo.validFrom);

    try {
      await this.client.request('AddCertificate', {
        CertName: certName,
        UserCert: fullchain,
        PrivateKey: privatekey,
      });
      this.log('添加证书成功，名称:' + certName);
    } catch (e: any) {
      if (e.message.includes('cert already exist')) {
        this.log('证书已存在，名称:' + certName);
      } else {
        throw new Error('添加证书失败 ' + e.message);
      }
    }

    let data: any;
    try {
      data = await this.client.request('GetUcdnDomainConfig', { 'DomainId.0': domainId });
    } catch (e: any) {
      throw new Error('获取加速域名配置失败 ' + e.message);
    }
    if (!data.DomainList || data.DomainList.length === 0) throw new Error('云分发资源ID:' + domainId + '不存在');
    const domain = data.DomainList[0].Domain;
    const httpsStatusCn = data.DomainList[0].HttpsStatusCn;
    const httpsStatusAbroad = data.DomainList[0].HttpsStatusAbroad;

    if (data.DomainList[0].CertNameCn === certName || data.DomainList[0].CertNameAbroad === certName) {
      this.log('云分发' + domainId + '证书已配置，无需重复操作');
      return;
    }

    try {
      data = await this.client.request('GetCertificateBaseInfoList', { Domain: domain });
    } catch (e: any) {
      throw new Error('获取可用证书列表失败 ' + e.message);
    }
    if (!data.CertList || data.CertList.length === 0) throw new Error('可用证书列表为空');

    let certId: string | null = null;
    for (const cert of data.CertList) {
      if (cert.CertName === certName) {
        certId = cert.CertId;
        break;
      }
    }
    if (!certId) throw new Error('证书ID不存在');
    this.log('证书ID获取成功:' + certId);

    const param: Record<string, any> = {
      DomainId: domainId,
      CertName: certName,
      CertId: certId,
      CertType: 'ucdn',
    };
    if (httpsStatusCn === 'enable') param.HttpsStatusCn = httpsStatusCn;
    if (httpsStatusAbroad === 'enable') param.HttpsStatusAbroad = httpsStatusAbroad;
    if (httpsStatusCn !== 'enable' && httpsStatusAbroad !== 'enable') param.HttpsStatusCn = 'enable';
    try {
      await this.client.request('UpdateUcdnDomainHttpsConfigV2', param);
    } catch (e: any) {
      throw new Error('https加速配置失败 ' + e.message);
    }
    this.log('云分发' + domainId + '证书配置成功！');
    info.cert_id = certId;
    info.cert_name = certName;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
