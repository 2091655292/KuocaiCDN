import { X509Certificate } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class UpyunDeploy implements DeployProvider {
  private username: string;
  private password: string;
  private cookie: string | null = null;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.password = config.password || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async send(
    url: string,
    data: string,
    cookie: string | null,
    isGet: boolean,
  ): Promise<{ status: number; body: string; result: any; setCookies: string[] }> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers,
      body: isGet ? undefined : data,
      redirect: 'manual',
    });
    const body = await res.text();
    let result: any = null;
    try {
      result = body ? JSON.parse(body) : null;
    } catch {
      result = null;
    }
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, body, result, setCookies };
  }

  async check(): Promise<void> {
    if (!this.username || !this.password) throw new Error('用户名或密码不能为空');
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, _config: Record<string, any>, _info: any): Promise<void> {
    await this.login();

    let privatekey_send = privatekey;
    if (this.isEcCertificate(fullchain)) {
      privatekey_send = privatekey_send.split('-----BEGIN PRIVATE KEY-----').join('-----BEGIN EC PRIVATE KEY-----');
      privatekey_send = privatekey_send.split('-----END PRIVATE KEY-----').join('-----END EC PRIVATE KEY-----');
    }
    const params = { certificate: fullchain, private_key: privatekey_send };

    const uploadData = new URLSearchParams(params as any).toString();
    let r = await this.send('https://console.upyun.com/api/https/certificate/', uploadData, this.cookie, false);
    let result = r.result;
    let common_name: string;
    let certificate_id: any;
    if (result?.data?.status === 0) {
      common_name = result.data.result.commonName;
      certificate_id = result.data.result.certificate_id;
      this.log('证书上传成功！证书ID:' + certificate_id);
    } else if (result?.data?.message) {
      throw new Error('证书上传失败:' + result.data.message);
    } else {
      throw new Error('证书上传失败');
    }

    const searchParams = new URLSearchParams({ limit: '100', domain: common_name }).toString();
    r = await this.send('https://console.upyun.com/api/https/certificate/search?' + searchParams, '', this.cookie, true);
    result = r.result;
    let cert_list: Record<string, any>;
    if (result?.data?.result && typeof result.data.result === 'object' && !Array.isArray(result.data.result)) {
      cert_list = result.data.result;
    } else if (result?.data?.message) {
      throw new Error('查找证书失败:' + result.data.message);
    } else {
      throw new Error('查找证书失败');
    }

    let i = 0;
    let d = 0;
    for (const [crt_id, item] of Object.entries(cert_list)) {
      if (crt_id == certificate_id || item.commonName !== common_name || item.config_domain === 0) continue;
      const migrateParams = new URLSearchParams({ new_crt_id: String(certificate_id), old_crt_id: crt_id }).toString();
      r = await this.send('https://console.upyun.com/api/https/migrate/certificate', migrateParams, this.cookie, false);
      result = r.result;
      if (result?.data?.result === true) {
        i++;
        d += item.config_domain;
        this.log('证书ID:' + crt_id + ' 迁移成功！');
      } else if (result?.data?.message) {
        throw new Error('证书迁移失败:' + result.data.message);
      } else {
        throw new Error('证书迁移失败');
      }
    }

    if (i === 0) {
      this.log('未找到可迁移的证书');
    } else {
      this.log('共迁移' + i + '个证书,关联域名' + d + '个');
    }
  }

  private async login(): Promise<void> {
    const data = new URLSearchParams({ username: this.username, password: this.password }).toString();
    const r = await this.send('https://console.upyun.com/accounts/signin/', data, null, false);
    const result = r.result;
    if (result?.data?.result === true) {
      const cookies = r.setCookies;
      let cookie = '';
      if (cookies.length) {
        for (const val of cookies) {
          const parts = val.split('=');
          const v = parts[1];
          if (v === undefined || v === '' || v === 'deleted') continue;
          cookie += val + '; ';
        }
      } else {
        throw new Error('登录成功，获取cookie失败');
      }
      this.cookie = cookie;
    } else if (result?.data?.message) {
      throw new Error('登录失败:' + result.data.message);
    } else {
      throw new Error('登录失败');
    }
  }

  private isEcCertificate(fullchain: string): boolean {
    const m = fullchain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
    if (!m) return false;
    try {
      const x = new X509Certificate(m[0]);
      return x.publicKey.asymmetricKeyType === 'ec';
    } catch {
      return false;
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}