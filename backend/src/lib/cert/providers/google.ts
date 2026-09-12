import { AcmeCertBase } from '../acmeBase.js';

export class GoogleCert extends AcmeCertBase {
  private static directories: Record<string, string> = {
    live: 'https://dv.acme-v02.api.pki.goog',
    staging: 'https://dv.acme-v02.test-api.pki.goog',
  };

  constructor(config: Record<string, any>, ext: any = null) {
    const mode = GoogleCert.directories[config.mode || 'live'] ? (config.mode || 'live') : 'live';
    const origin = GoogleCert.directories[mode];
    const proxyConfig = { origin, proxy: String(config.proxy_url || '').replace(/\/+$/, '') };
    super(config, origin + '/directory', ext, proxyConfig);
  }

  async register() {
    if (!this.config.email) throw new Error('邮件地址不能为空');

    let eab: { kid: string; key: string };
    if (this.config.eabMode === 'auto') {
      eab = await this.getEAB();
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

  private async getEAB(): Promise<{ kid: string; key: string }> {
    const res = await fetch('https://gts.rat.dev/eab');
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('解析返回数据失败：' + text);
    }
    if (!('msg' in result)) {
      throw new Error('解析返回数据失败：' + text);
    }
    if (result.msg !== 'success') {
      throw new Error('获取EAB失败：' + result.msg);
    }
    if (!result.data?.key_id || !result.data?.mac_key) {
      throw new Error('获取EAB失败：返回数据不完整');
    }
    return { kid: result.data.key_id, key: result.data.mac_key };
  }
}