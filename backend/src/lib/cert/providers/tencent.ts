import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TencentCloud } from '../../clients/TencentCloud.js';
import { getMainDomain, parseCertPem, unzip, findFileByExt } from '../utils.js';
import type { CertProvider, CreateOrderResult, CertInfo } from '../types.js';

export class TencentCert implements CertProvider {
  private email: string;
  private client: TencentCloud;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>, _ext: any = null) {
    this.client = new TencentCloud(config.SecretId, config.SecretKey, 'ssl.tencentcloudapi.com', 'ssl', '2019-12-05');
    this.email = config.email || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private request(action: string, param: Record<string, any>): Promise<any> {
    this.log('Action:' + action + '\nRequest:' + JSON.stringify(param));
    return this.client.request(action, param).then((result) => {
      this.log('Response:' + JSON.stringify(result));
      return result;
    });
  }

  async register() {
    if (!this.email) throw new Error('必填参数不能为空');
    await this.request('DescribeCertificates', {});
    return true;
  }

  async buyCert(_domainList: string[]): Promise<any> {
    return null;
  }

  async createOrder(domainList: string[], keytype: string, _keysize: string, _order?: any): Promise<CreateOrderResult> {
    if (!domainList.length) throw new Error('域名列表不能为空');
    const domain = domainList[0];
    let data = await this.request('ApplyCertificate', {
      DvAuthMethod: 'DNS',
      DomainName: domain,
      ContactEmail: this.email,
      CsrEncryptAlgo: keytype,
      CsrKeyParameter: keytype === 'ECC' ? 'prime256v1' : '2048',
    });
    if (!data.CertificateId) throw new Error('证书申请失败，CertificateId为空');
    const order: any = { CertificateId: data.CertificateId };

    data = await this.request('DescribeCertificate', { CertificateId: order.CertificateId });
    order.OrderId = data.OrderId;

    const dnsList: Record<string, any[]> = {};
    for (const opts of data.DvAuthDetail?.DvAuths || []) {
      const mainDomain = await getMainDomain(opts.DvAuthKey);
      const name = opts.DvAuthKey.slice(0, -(mainDomain.length + 1));
      if (!dnsList[mainDomain]) dnsList[mainDomain] = [];
      dnsList[mainDomain].push({ name, type: opts.DvAuthVerifyType || 'CNAME', value: opts.DvAuthValue });
    }
    return { dnsList, order };
  }

  async authOrder(_domainList: string[], order: any): Promise<void> {
    const data = await this.request('DescribeCertificate', { CertificateId: order.CertificateId });
    if (data.Status === 0 || data.Status === 4) {
      await this.request('CompleteCertificate', { CertificateId: order.CertificateId });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async getAuthStatus(_domainList: string[], order: any): Promise<boolean> {
    const data = await this.request('DescribeCertificate', { CertificateId: order.CertificateId });
    if (data.Status === 1) return true;
    if (data.Status === 2) throw new Error('证书审核失败' + (data.StatusMsg ? ':' + data.StatusMsg : ''));
    return false;
  }

  async finalizeOrder(_domainList: string[], order: any, _keytype: string, _keysize: string): Promise<CertInfo> {
    await this.request('ModifyCertificatesExpiringNotificationSwitch', {
      CertificateIds: [order.CertificateId],
      SwitchStatus: 1,
    });

    const data = await this.request('DescribeDownloadCertificateUrl', {
      CertificateId: order.CertificateId,
      ServiceType: 'nginx',
    });

    const res = await fetch(data.DownloadCertificateUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('下载证书失败');

    const dir = mkdtempSync(join(tmpdir(), 'cert_'));
    try {
      const zipPath = join(dir, data.DownloadFilename);
      writeFileSync(zipPath, buf);
      unzip(zipPath, dir);
      const keyFile = findFileByExt(dir, ['.key']);
      const crtFile = findFileByExt(dir, ['.crt']);
      if (!keyFile || !crtFile) throw new Error('解压后的证书文件夹内未找到证书文件');
      const private_key = readFileSync(keyFile, 'utf8');
      const fullchain = readFileSync(crtFile, 'utf8');
      const certInfo = parseCertPem(fullchain);
      return {
        private_key,
        fullchain,
        issuer: certInfo.issuer,
        subject: certInfo.subject,
        validFrom: certInfo.validFrom,
        validTo: certInfo.validTo,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async revoke(order: any, _pem: string): Promise<void> {
    await this.request('RevokeCertificate', { CertificateId: order.CertificateId });
  }

  async cancel(order: any): Promise<void> {
    await this.request('CancelAuditCertificate', { CertificateId: order.CertificateId });
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}