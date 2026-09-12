import { createHash, createHmac } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class RatpanelDeploy implements DeployProvider {
  private url: string;
  private id: string;
  private token: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.id = config.id || '';
    this.token = config.token || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private signRequest(method: string, url: string, body: string | null, id: string, token: string) {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const query = parsed.search.replace(/^\?/, '');

    let canonicalPath = path;
    if (!path.startsWith('/api')) {
      const apiPos = path.indexOf('/api');
      if (apiPos !== -1) {
        canonicalPath = path.substring(apiPos);
      }
    }

    const canonicalRequest = [method, canonicalPath, query, createHash('sha256').update(body || '').digest('hex')].join('\n');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const stringToSign = ['HMAC-SHA256', timestamp, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signature = createHmac('sha256', token).update(stringToSign).digest('hex');

    return { timestamp, signature, id };
  }

  private async request(path: string, params?: Record<string, any> | null, method = 'POST'): Promise<string> {
    const url = this.url + '/api' + path;
    const body = method === 'GET' ? null : JSON.stringify(params || {});
    const sign = this.signRequest(method, url, body, this.id, this.token);
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': sign.timestamp,
        Authorization: 'HMAC-SHA256 Credential=' + sign.id + ', Signature=' + sign.signature,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    return await res.text();
  }

  async check(): Promise<void> {
    if (!this.url || !this.id || !this.token) throw new Error('请填写完整面板地址和访问令牌');
    const response = await this.request('/user/info', null, 'GET');
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error('面板地址无法连接');
    }
    if (result.msg && result.msg === 'success') return;
    throw new Error(result.msg || '面板地址无法连接');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.type === '1') {
      await this.deployPanel(fullchain, privatekey);
      this.log('面板证书部署成功');
      return;
    }
    const sites = String(config.sites || '').split('\n');
    let success = 0;
    let errmsg: string | null = null;
    for (const site of sites) {
      const siteName = site.trim();
      if (!siteName) continue;
      try {
        await this.deploySite(siteName, fullchain, privatekey);
        this.log('网站 ' + siteName + ' 证书部署成功');
        success++;
      } catch (e: any) {
        errmsg = e.message;
        this.log('网站 ' + siteName + ' 证书部署失败：' + errmsg);
      }
    }
    if (success === 0) {
      throw new Error(errmsg || '要部署的网站不存在');
    }
  }

  private async deployPanel(fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/setting/cert', { cert: fullchain, key: privatekey });
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.msg && result.msg === 'success') return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  private async deploySite(name: string, fullchain: string, privatekey: string): Promise<void> {
    const response = await this.request('/website/cert', { name, cert: fullchain, key: privatekey });
    let result: any;
    try {
      result = JSON.parse(response);
    } catch {
      throw new Error(response || '返回数据解析失败');
    }
    if (result.msg && result.msg === 'success') return;
    if (result.msg) throw new Error(result.msg);
    throw new Error(response || '返回数据解析失败');
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
