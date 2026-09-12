import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class SynologyDeploy implements DeployProvider {
  private url: string;
  private username: string;
  private password: string;
  private version: string;
  private token: { sid: string; synotoken: string } | null = null;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.username = config.username || '';
    this.password = config.password || '';
    this.version = config.version || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async login(): Promise<void> {
    const url = this.url + '/webapi/' + (this.version === '1' ? 'auth.cgi' : 'entry.cgi');
    const form = new URLSearchParams({
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      session: 'webui',
      account: this.username,
      passwd: this.password,
      format: 'sid',
      enable_syno_token: 'yes',
    });
    const res = await fetch(url, {
      method: 'POST',
      body: form.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('请求失败(httpCode=' + res.status + ')');
    }
    if (result.success) {
      this.token = result.data;
    } else if (result.error) {
      throw new Error('登录失败：' + JSON.stringify(result.error));
    } else {
      throw new Error('请求失败(httpCode=' + res.status + ')');
    }
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    await this.login();
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');

    const query = new URLSearchParams({
      api: 'SYNO.Core.Certificate.CRT',
      version: '1',
      method: 'list',
      _sid: this.token!.sid,
      SynoToken: this.token!.synotoken,
    });
    const res = await fetch(this.url + '/webapi/entry.cgi?' + query.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('获取证书列表失败(httpCode=' + res.status + ')');
    }
    if (result.success) {
      this.log('获取证书列表成功');
    } else if (result.error) {
      throw new Error('获取证书列表失败：' + JSON.stringify(result.error));
    } else {
      throw new Error('获取证书列表失败(httpCode=' + res.status + ')');
    }

    let id: string | null = null;
    let validFrom = 0;
    for (const certificate of result.data.certificates || []) {
      if (certificate.subject.common_name === certInfo.subject || certificate.desc === config.desc) {
        id = certificate.id;
        validFrom = Math.floor(new Date(certificate.valid_from.replace(/(\d{4}) (\w+)$/, '$2 $1')).getTime() / 1000);
        if (isNaN(validFrom)) validFrom = Math.floor(new Date(certificate.valid_from).getTime() / 1000);
        break;
      }
    }
    if (id) {
      if (validFrom === Math.floor(certInfo.validFrom)) {
        this.log('证书ID:' + id + '已存在，无需更新');
        return;
      }
      await this.import(fullchain, privatekey, config, id);
    } else {
      await this.import(fullchain, privatekey, config);
    }
  }

  private async import(fullchain: string, privatekey: string, config: Record<string, any>, id?: string | null): Promise<void> {
    const query = new URLSearchParams({
      api: 'SYNO.Core.Certificate',
      version: '1',
      method: 'import',
      _sid: this.token!.sid,
      SynoToken: this.token!.synotoken,
    });
    const form = new FormData();
    form.append('key', new Blob([privatekey]), 'key.pem');
    form.append('cert', new Blob([fullchain]), 'cert.pem');
    if (id) form.append('id', id);
    form.append('desc', config.desc || '');
    const res = await fetch(this.url + '/webapi/entry.cgi?' + query.toString(), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (id) {
      if (result && result.success) {
        this.log('证书ID:' + id + '更新成功！');
      } else if (result && result.error) {
        throw new Error('证书ID:' + id + '更新失败：' + JSON.stringify(result.error));
      } else {
        throw new Error('证书ID:' + id + '更新失败(httpCode=' + res.status + ')');
      }
    } else {
      if (result && result.success) {
        this.log('证书上传成功！');
      } else if (result && result.error) {
        throw new Error('证书上传失败：' + JSON.stringify(result.error));
      } else {
        throw new Error('证书上传失败(httpCode=' + res.status + ')');
      }
    }
  }

  async check(): Promise<void> {
    if (!this.url || !this.username || !this.password) throw new Error('必填内容不能为空');
    await this.login();
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
