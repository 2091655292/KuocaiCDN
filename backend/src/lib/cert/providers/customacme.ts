import { AcmeCertBase } from '../acmeBase.js';

export class CustomacmeCert extends AcmeCertBase {
  constructor(config: Record<string, any>, ext: any = null) {
    super(config, config.directory || '', ext);
  }

  async register() {
    if (!this.config.directory) throw new Error('ACME地址不能为空');
    if (!this.config.email) throw new Error('邮件地址不能为空');

    if (this.ext?.key) {
      const kid = this.config.kid && this.config.key
        ? this.ac.registerEAB(true, this.config.kid, this.config.key, this.config.email)
        : this.ac.register(true, this.config.email);
      return { kid, key: this.ext.key };
    }

    const key = this.ac.generateRSAKey(2048);
    this.ac.loadAccountKey(key);
    const kid = this.config.kid && this.config.key
      ? this.ac.registerEAB(true, this.config.kid, this.config.key, this.config.email)
      : this.ac.register(true, this.config.email);
    return { kid, key };
  }
}