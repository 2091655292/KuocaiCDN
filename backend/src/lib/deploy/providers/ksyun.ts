import { Ksyun } from '../../clients/Ksyun.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class KsyunDeploy implements DeployProvider {
  private AccessKeyId: string;
  private SecretAccessKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKeyId = config.AccessKeyId || '';
    this.SecretAccessKey = config.SecretAccessKey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey) throw new Error('必填参数不能为空');
    const client = new Ksyun(this.AccessKeyId, this.SecretAccessKey, 'cdn.api.ksyun.com', 'cdn', 'cn-shanghai-2');
    await client.request('GET', 'GetCertificates', '2016-09-01', '/2016-09-01/cert/GetCertificates');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
    const domains = String(config.domain).split(',');

    const client = new Ksyun(this.AccessKeyId, this.SecretAccessKey, 'cdn.api.ksyun.com', 'cdn', 'cn-shanghai-2');
    const listResult = await client.request('GET', 'GetCdnDomains', '2019-06-01', '/2019-06-01/domain/GetCdnDomains', {
      PageSize: 100,
      PageNumber: 1,
    });
    const domainIds: string[] = [];
    for (const row of listResult.Domains || []) {
      if (domains.includes(row.DomainName)) {
        domainIds.push(row.DomainId);
      }
    }
    if (domainIds.length === 0) throw new Error('未找到对应的CDN域名');
    const result = await client.request('POST', 'ConfigCertificate', '2016-09-01', '/2016-09-01/cert/ConfigCertificate', {
      Enable: 'on',
      DomainIds: domainIds.join(','),
      CertificateName: certName,
      ServerCertificate: fullchain,
      PrivateKey: privatekey,
    });
    this.log('CDN证书部署成功，证书ID：' + result.CertificateId);
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
