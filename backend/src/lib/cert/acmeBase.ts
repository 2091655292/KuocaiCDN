import { ACMECert } from '../acme/ACMECert.js';
import { getMainDomain, parseCertPem } from './utils.js';
import type { CertProvider, CreateOrderResult, CertInfo } from './types.js';

export abstract class AcmeCertBase implements CertProvider {
  protected ac: ACMECert;
  protected config: Record<string, any>;
  protected ext: any;

  constructor(config: Record<string, any>, directory: string, ext: any = null, proxyConfig: any = null) {
    this.config = config;
    this.ac = new ACMECert(directory, Number(config.proxy || 0), proxyConfig);
    if (ext) {
      this.ext = ext;
      this.ac.loadAccountKey(ext.key);
      this.ac.setAccount(ext.kid);
    }
  }

  abstract register(): Promise<any>;

  async buyCert(_domainList: string[]): Promise<any> {
    return null;
  }

  async createOrder(domainList: string[], _keytype: string, _keysize: string, _order?: any): Promise<CreateOrderResult> {
    const domainConfig: Record<string, any> = {};
    for (const domain of domainList) {
      if (!domain) continue;
      domainConfig[domain] = { challenge: 'dns-01' };
    }
    if (!Object.keys(domainConfig).length) throw new Error('域名列表不能为空');

    const order = this.ac.createOrder(domainConfig);

    const dnsList: Record<string, any[]> = {};
    const seen = new Set<string>();
    for (const opts of order.challenges || []) {
      const key = opts.key + '|' + opts.value;
      if (seen.has(key)) continue;
      seen.add(key);
      const mainDomain = await getMainDomain(opts.domain);
      const name = opts.key.slice(0, -(mainDomain.length + 1));
      if (!dnsList[mainDomain]) dnsList[mainDomain] = [];
      dnsList[mainDomain].push({ name, type: 'TXT', value: opts.value });
    }
    return { dnsList, order };
  }

  async authOrder(_domainList: string[], order: any): Promise<void> {
    await this.ac.authOrder(order);
  }

  async getAuthStatus(_domainList: string[], _order: any): Promise<boolean> {
    return true;
  }

  async finalizeOrder(domainList: string[], order: any, keytype: string, keysize: string): Promise<CertInfo> {
    if (!domainList.length) throw new Error('域名列表不能为空');

    let privateKey: string;
    if (keytype === 'ECC') {
      privateKey = this.ac.generateECKey(keysize || '384');
    } else {
      privateKey = this.ac.generateRSAKey(keysize || '2048');
    }
    const fullchain = await this.ac.finalizeOrder(domainList, order, privateKey);
    const certInfo = parseCertPem(fullchain);
    return {
      private_key: privateKey,
      fullchain,
      issuer: certInfo.issuer,
      subject: certInfo.subject,
      validFrom: certInfo.validFrom,
      validTo: certInfo.validTo,
    };
  }

  async revoke(_order: any, pem: string): Promise<void> {
    this.ac.revoke(pem);
  }

  async cancel(_order: any): Promise<void> {
    return;
  }

  setLogger(func: (txt: string) => void): void {
    this.ac.setLogger(func);
  }
}