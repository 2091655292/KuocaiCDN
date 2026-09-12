import { AcmeCertBase } from '../acmeBase.js';

export class ZerosslCert extends AcmeCertBase {
  private directory = 'https://acme.zerossl.com/v2/DV90';

  constructor(config: Record<string, any>, ext: any = null) {
    super(config, 'https://acme.zerossl.com/v2/DV90', ext);
  }

  async register() {
    if (!this.config.email) throw new Error('邮件地址不能为空');

    let eab: { kid: string; key: string };
    if (this.config.eabMode === 'auto') {
      eab = await this.getEAB(this.config.email);
    } else {
      eab = { kid: this.config.kid, key: this.config.key };
    }

    if (this.ext?.key) {
      const kid = this.ac.registerEAB(true, eab.kid, eab.key, this.config.email);
      return { kid, key: this.ext.key };
    }
    const key = this.ac.generateRSAKey(2048);
    this.ac.loadAccountKey(key);
    const kid = this.ac.registerEAB(true, eab.kid, eab.key, this.config.email);
    return { kid, key };
  }

  private async getEAB(email: string): Promise<{ kid: string; key: string }> {
    const res = await fetch('https://api.zerossl.com/acme/eab-credentials-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email }).toString(),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('获取EAB失败：' + text);
    }
    if (!('success' in result)) {
      throw new Error('获取EAB失败：' + text);
    }
    if (!result.success && result.error) {
      throw new Error('获取EAB失败：' + result.error.code + ' - ' + result.error.type);
    }
    if (!result.eab_kid || !result.eab_hmac_key) {
      throw new Error('获取EAB失败：返回数据不完整');
    }
    return { kid: result.eab_kid, key: result.eab_hmac_key };
  }
}