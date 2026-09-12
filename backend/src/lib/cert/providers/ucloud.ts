import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ucloud } from '../../clients/Ucloud.js';
import { getMainDomain, unzip, findFileByExt } from '../utils.js';
import type { CertProvider, CreateOrderResult, CertInfo } from '../types.js';

export class UcloudCert implements CertProvider {
  private config: Record<string, any>;
  private client: Ucloud;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>, _ext: any = null) {
    this.config = config;
    this.client = new Ucloud(config.PublicKey, config.PrivateKey);
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private request(action: string, params: Record<string, any>): Promise<any> {
    this.log('Action:' + action + '\nRequest:' + JSON.stringify(params));
    return this.client.request(action, params).then((result) => {
      this.log('Response:' + JSON.stringify(result));
      return result;
    });
  }

  async register() {
    if (!this.config.PublicKey || !this.config.PrivateKey || !this.config.username || !this.config.phone || !this.config.email) {
      throw new Error('必填参数不能为空');
    }
    await this.request('GetCertificateList', { Mode: 'free' });
    return true;
  }

  async buyCert(_domainList: string[]): Promise<any> {
    const data = await this.request('PurchaseCertificate', {
      CertificateBrand: 'TrustAsia',
      CertificateName: 'TrustAsiaC1DVFree',
      DomainsCount: 1,
      ValidYear: 1,
    });
    if (!data.CertificateID) throw new Error('证书购买失败，CertificateID为空');
    return { CertificateID: data.CertificateID };
  }

  async createOrder(domainList: string[], keytype: string, keysize: string, order: any = null): Promise<CreateOrderResult> {
    if (!domainList.length) throw new Error('域名列表不能为空');
    const domain = domainList[0];

    const keyParamMap: Record<string, string> = { '2048': '2048', '3072': '3072', '256': 'prime256v1', '384': 'prime384v1' };
    await this.request('ComplementCSRInfo', {
      CertificateID: order.CertificateID,
      Domains: domain,
      CSROnline: 1,
      CSREncryptAlgo: keytype === 'ECC' ? 'ECDSA' : 'RSA',
      CSRKeyParameter: keyParamMap[keysize] || '2048',
      CompanyName: '公司名称',
      CompanyAddress: '公司地址',
      CompanyRegion: '北京',
      CompanyCity: '北京',
      CompanyCountry: 'CN',
      CompanyDivision: '部门',
      CompanyPhone: this.config.phone,
      CompanyPostalCode: '110100',
      AdminName: this.config.username,
      AdminPhone: this.config.phone,
      AdminEmail: this.config.email,
      AdminTitle: '职员',
      DVAuthMethod: 'DNS',
    });

    await new Promise((r) => setTimeout(r, 3000));

    const data = await this.request('GetDVAuthInfo', { CertificateID: order.CertificateID });

    const dnsList: Record<string, any[]> = {};
    for (const auth of data.Auths || []) {
      const mainDomain = await getMainDomain(auth.Domain);
      const name = auth.AuthKey.slice(0, -(mainDomain.length + 1));
      if (!dnsList[mainDomain]) dnsList[mainDomain] = [];
      dnsList[mainDomain].push({ name, type: auth.AuthType === 'DNS_TXT' ? 'TXT' : 'CNAME', value: auth.AuthValue });
    }
    return { dnsList, order };
  }

  async authOrder(_domainList: string[], _order: any): Promise<void> {
    return;
  }

  async getAuthStatus(_domainList: string[], order: any): Promise<boolean> {
    const data = await this.request('GetCertificateDetailInfo', { CertificateID: order.CertificateID });
    const code = data.CertificateInfo?.StateCode;
    if (code === 'COMPLETED' || code === 'RENEWED') return true;
    if (code === 'REJECTED' || code === 'SECURITY_REVIEW_FAILED') {
      throw new Error('证书审核失败:' + data.CertificateInfo.State);
    }
    return false;
  }

  async finalizeOrder(_domainList: string[], order: any, _keytype: string, _keysize: string): Promise<CertInfo> {
    const info = await this.request('GetCertificateDetailInfo', { CertificateID: order.CertificateID });

    const data = await this.request('DownloadCertificate', { CertificateID: order.CertificateID });
    const res = await fetch(data.CertificateUrl);
    const buf = Buffer.from(await res.arrayBuffer());

    const dir = mkdtempSync(join(tmpdir(), 'cert_'));
    try {
      const zipPath = join(dir, 'USSL_' + order.CertificateID + '.zip');
      writeFileSync(zipPath, buf);
      unzip(zipPath, dir);
      const keyFile = findFileByExt(dir, ['.key']);
      const pemFile = findFileByExt(dir, ['.pem']);
      if (!keyFile || !pemFile) throw new Error('解压后的证书文件夹内未找到证书文件');
      const private_key = readFileSync(keyFile, 'utf8');
      const fullchain = readFileSync(pemFile, 'utf8');
      return {
        private_key,
        fullchain,
        issuer: info.CertificateInfo.CaOrganization,
        subject: info.CertificateInfo.Name,
        validFrom: info.CertificateInfo.IssuedDate,
        validTo: info.CertificateInfo.ExpiredDate,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async revoke(order: any, _pem: string): Promise<void> {
    await this.request('RevokeCertificate', { CertificateID: order.CertificateID, Reason: '业务终止' });
  }

  async cancel(order: any): Promise<void> {
    await this.request('CancelCertificateOrder', { CertificateID: order.CertificateID });
    await new Promise((r) => setTimeout(r, 1000));
    await this.request('DeleteSSLCertificate', { CertificateID: order.CertificateID, CertificateMode: 'purchase' });
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}