import type { DeployProvider } from '../types.js';

export class RainyunDeploy implements DeployProvider {
  private url = 'https://api.v2.rainyun.com';
  private apikey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.apikey = config.apikey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(path: string, params?: Record<string, any>, method?: string): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { 'x-api-key': this.apikey };
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
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
      result = null;
    }
    if (result && result.code === 200) {
      return result.data ?? null;
    }
    if (result && result.message !== undefined) throw new Error(result.message);
    if (text) this.log('Response:' + text);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.apikey) throw new Error('ApiKey不能为空');
    await this.request('/product/');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.id) {
      const params = { cert: fullchain, key: privatekey };
      try {
        await this.request('/product/sslcenter/', params, 'POST');
      } catch (e: any) {
        throw new Error('上传证书失败，' + e.message);
      }

      const query = encodeURIComponent('{"columnFilters":{"Domain":""},"sort":[],"page":1,"perPage":1}');
      let data: any;
      try {
        data = await this.request('/product/sslcenter/?options=' + query, undefined, 'GET');
      } catch (e: any) {
        throw new Error('获取证书列表失败，' + e.message);
      }
      if (!data || !data.Records || data.Records.length === 0) throw new Error('未找到已上传的证书');
      const certId = data.Records[0].ID;
      if (!info.config) info.config = {};
      info.config.id = certId;

      this.log('证书ID:' + certId + '添加成功！');
    } else {
      const params = { cert: fullchain, key: privatekey };
      try {
        await this.request('/product/sslcenter/' + config.id, params, 'PUT');
      } catch (e: any) {
        throw new Error(e.message);
      }

      this.log('证书ID:' + config.id + '更新成功！');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
