import type { DeployProvider } from '../types.js';

export class SafelineDeploy implements DeployProvider {
  private url: string;
  private token: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.token = config.token || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { 'X-SLCE-API-TOKEN': this.token };
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (res.status === 200 && result) {
      return result.data ?? null;
    }
    throw new Error((result && result.msg) || '请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.url || !this.token) throw new Error('请填写控制台地址和API Token');
    await this.request('/api/open/system');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const domains: string[] = config.domainList;
    if (!domains || domains.length === 0) throw new Error('没有设置要部署的域名');

    let data: any;
    try {
      data = await this.request('/api/open/cert');
      this.log('获取证书列表成功(total=' + data.total + ')');
    } catch (e: any) {
      throw new Error('获取证书列表失败：' + e.message);
    }

    let success = 0;
    let errmsg: string | null = null;
    for (const row of data.nodes || []) {
      if (!row.domains) continue;
      const flag = row.domains.some((domain: string) => {
        if (domains.includes(domain)) return true;
        const wildcard = '*' + domain.substring(domain.indexOf('.'));
        return domains.includes(wildcard);
      });
      if (flag) {
        const params = {
          id: row.id,
          manual: { crt: fullchain, key: privatekey },
          type: 2,
        };
        try {
          await this.request('/api/open/cert', params);
          this.log('证书ID:' + row.id + '更新成功！');
          success++;
        } catch (e: any) {
          errmsg = e.message;
          this.log('证书ID:' + row.id + '更新失败：' + errmsg);
        }
      }
    }
    if (success === 0) {
      const params = {
        manual: { crt: fullchain, key: privatekey },
        type: 2,
      };
      await this.request('/api/open/cert', params);
      this.log('证书上传成功！');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
