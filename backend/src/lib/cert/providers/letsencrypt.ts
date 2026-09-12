import { AcmeCertBase } from '../acmeBase.js';

export class LetsencryptCert extends AcmeCertBase {
  private static directories: Record<string, string> = {
    live: 'https://acme-v02.api.letsencrypt.org/directory',
    staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  };

  constructor(config: Record<string, any>, ext: any = null) {
    const mode = LetsencryptCert.directories[config.mode || 'live'] ? (config.mode || 'live') : 'live';
    super(config, LetsencryptCert.directories[mode], ext);
  }

  async register() {
    if (!this.config.email) throw new Error('邮件地址不能为空');
    if (this.ext?.key) {
      const kid = this.ac.register(true, this.config.email);
      return { kid, key: this.ext.key };
    }
    const key = this.ac.generateRSAKey(2048);
    this.ac.loadAccountKey(key);
    const kid = this.ac.register(true, this.config.email);
    return { kid, key };
  }
}