import { X509Certificate } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class ProxmoxDeploy implements DeployProvider {
  private url: string;
  private apiUser: string;
  private apiKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.apiUser = config.api_user || '';
    this.apiKey = config.api_key || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async sendRequest(path: string, params?: Record<string, any>): Promise<any> {
    const url = this.url + path;
    const headers: Record<string, string> = { Authorization: 'PVEAPIToken=' + this.apiUser + '=' + this.apiKey };
    let body: string | undefined;
    if (params) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        form.append(k, String(v));
      }
      body = form.toString();
    }
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (res.status !== 200) {
      throw new Error('请求失败(httpCode=' + res.status + ', body=' + text + ')');
    }
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('返回数据解析失败');
    }
    if (result.data !== undefined) {
      return result.data;
    }
    if (result.errors !== undefined) {
      const errors = Array.isArray(result.errors) ? result.errors.join(';') : result.errors;
      throw new Error(String(errors));
    }
    throw new Error('返回数据解析失败');
  }

  async check(): Promise<void> {
    if (!this.url || !this.apiUser || !this.apiKey) throw new Error('必填内容不能为空');
    await this.sendRequest('/api2/json/access');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.node) throw new Error('节点名称不能为空');
    let certHash: string;
    try {
      const x = new X509Certificate(fullchain);
      certHash = x.fingerprint256.replace(/:/g, '').toLowerCase();
    } catch {
      throw new Error('证书解析失败');
    }

    const list = await this.sendRequest('/api2/json/nodes/' + config.node + '/certificates/info');
    for (const item of list || []) {
      const fingerprint = String(item.fingerprint || '').split(':').join('').toLowerCase();
      if (fingerprint === certHash) {
        this.log('节点：' + config.node + ' 证书已存在');
        return;
      }
    }

    await this.sendRequest('/api2/json/nodes/' + config.node + '/certificates/custom', {
      certificates: fullchain,
      key: privatekey,
      force: 1,
      restart: 1,
    });
    this.log('节点：' + config.node + ' 证书部署成功！');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
