import { AcmeCertBase } from '../acmeBase.js';

export class LitesslCert extends AcmeCertBase {
  constructor(config: Record<string, any>, ext: any = null) {
    super(config, 'https://acme.litessl.com/acme/v2/directory', ext);
  }

  async register() {
    if (!this.config.email) throw new Error('邮件地址不能为空');
    if (!this.config.kid || !this.config.key) throw new Error('EAB密钥不能为空');

    if (this.ext?.key) {
      const kid = this.ac.registerEAB(true, this.config.kid, this.config.key, this.config.email);
      return { kid, key: this.ext.key };
    }
    const key = this.ac.generateRSAKey(2048);
    this.ac.loadAccountKey(key);
    const kid = this.ac.registerEAB(true, this.config.kid, this.config.key, this.config.email);
    return { kid, key };
  }
}