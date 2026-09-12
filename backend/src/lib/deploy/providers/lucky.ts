import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class LuckyDeploy implements DeployProvider {
  private url: string;
  private opentoken: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '') + (config.path || '');
    this.opentoken = config.opentoken || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { openToken: this.opentoken };
    let body: string | undefined;
    if (params) {
      body = JSON.stringify(params);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('请求失败(httpCode=' + res.status + ')');
    }
    if (result.ret === 0) return result;
    if (result.msg !== undefined) throw new Error(result.msg);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.url || !this.opentoken) throw new Error('请填写面板地址和OpenToken');
    await this.request('/api/modules/list');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const domains: string[] = config.domainList;
    if (!domains || domains.length === 0) throw new Error('没有设置要部署的域名');

    let data: any;
    try {
      data = await this.request('/api/ssl');
      this.log('获取证书列表成功');
    } catch (e: any) {
      throw new Error('获取证书列表失败：' + e.message);
    }

    let success = 0;
    let errmsg: string | null = null;
    if (data.list && data.list.length > 0) {
      for (const row of data.list) {
        if (!row.CertsInfo || !row.CertsInfo.Domains) continue;
        const flag = row.CertsInfo.Domains.some((domain: string) => domains.includes(domain));
        if (flag) {
          const params = {
            Key: row.Key,
            CertBase64: Buffer.from(fullchain).toString('base64'),
            KeyBase64: Buffer.from(privatekey).toString('base64'),
            AddFrom: 'file',
            Enable: true,
            MappingToPath: false,
            Remark: row.Remark || '',
            AllSyncClient: false,
          };
          try {
            await this.request('/api/ssl', params, 'PUT');
            this.log('证书ID:' + row.Key + '更新成功！');
            success++;
          } catch (e: any) {
            errmsg = e.message;
            this.log('证书ID:' + row.Key + '更新失败：' + errmsg);
          }
        }
      }
    }
    if (success === 0) {
      throw new Error(errmsg || '没有要更新的证书');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
