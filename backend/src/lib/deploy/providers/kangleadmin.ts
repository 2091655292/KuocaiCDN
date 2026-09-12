import { createHash } from 'node:crypto';
import type { DeployProvider } from '../types.js';

interface HttpResponse {
  code: number;
  redirectUrl: string;
  cookies: string[];
  body: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

export class KangleadminDeploy implements DeployProvider {
  private url: string;
  private path: string;
  private username: string;
  private skey: string;
  private cookie = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.path = String(config.path || '/admin').replace(/\/+$/, '');
    this.username = config.username || '';
    this.skey = config.skey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private htmlspecialchars(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private buildCookie(cookies: string[]): string {
    let cookie = '';
    for (const val of cookies) {
      const parts = val.split('=');
      const v = parts[1];
      if (!v || v === 'deleted') continue;
      cookie += val + '; ';
    }
    return cookie;
  }

  private async request(url: string, method: string, options: { body?: string; cookie?: string } = {}): Promise<HttpResponse> {
    const headers: Record<string, string> = { 'User-Agent': UA };
    if (options.body !== undefined && method.toUpperCase() === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (options.cookie) headers['Cookie'] = options.cookie;
    const res = await fetch(url, { method, headers, body: options.body, redirect: 'manual' });
    const body = await res.text();
    return { code: res.status, redirectUrl: res.headers.get('location') || '', cookies: res.headers.getSetCookie(), body };
  }

  async check(): Promise<void> {
    if (!this.url || !this.username || !this.skey) throw new Error('必填参数不能为空');
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.name) throw new Error('网站用户名不能为空');
    await this.login();
    this.log('登录成功 cookie:' + this.cookie);
    await this.loginVhost(config.name);

    if (config.type === '1' && config.domains) {
      const domains = String(config.domains).split('\n');
      let success = 0;
      let errmsg: string | null = null;
      for (const raw of domains) {
        const domain = raw.trim();
        if (!domain) continue;
        try {
          await this.deployDomain(domain, fullchain, privatekey);
          this.log('域名 ' + domain + ' 证书部署成功');
          success++;
        } catch (e: any) {
          errmsg = e.message;
          this.log('域名 ' + domain + ' 证书部署失败：' + errmsg);
        }
      }
      if (success === 0) throw new Error(errmsg || '要部署的域名不存在');
    } else {
      await this.deployAccount(fullchain, privatekey);
      this.log('账号级SSL证书部署成功');
    }
  }

  private async deployDomain(domain: string, fullchain: string, privatekey: string): Promise<boolean> {
    const path = '/vhost/?c=ssl&a=domainSsl';
    const post = { domain, certificate: fullchain, certificate_key: privatekey };
    const response = await this.request(this.url + path, 'POST', { body: new URLSearchParams(post).toString(), cookie: this.cookie });
    if (response.body.includes('成功')) {
      return true;
    }
    const match = response.body.match(/alert\('(.*?)'\)/i);
    if (match) throw new Error(this.htmlspecialchars(match[1]));
    if (response.body.length > 3 && response.body.length < 50) throw new Error(this.htmlspecialchars(response.body));
    throw new Error('原因未知(httpCode=' + response.code + ')');
  }

  private async deployAccount(fullchain: string, privatekey: string): Promise<boolean> {
    const path = '/vhost/?c=ssl&a=ssl';
    const post = { certificate: fullchain, certificate_key: privatekey };
    const response = await this.request(this.url + path, 'POST', { body: new URLSearchParams(post).toString(), cookie: this.cookie });
    if (response.body.includes('成功')) {
      return true;
    }
    const match = response.body.match(/alert\('(.*?)'\)/i);
    if (match) throw new Error(this.htmlspecialchars(match[1]));
    if (response.body.length > 3 && response.body.length < 50) throw new Error(this.htmlspecialchars(response.body));
    throw new Error('原因未知(httpCode=' + response.code + ')');
  }

  private async login(): Promise<boolean> {
    const url = this.url + this.path + '/index.php?c=sso&a=hello&url=' + encodeURIComponent(this.url + this.path + '/index.php?');
    const response = await this.request(url, 'GET');
    if (response.code === 302 && response.redirectUrl) {
      if (response.cookies.length > 0) {
        const cookie = this.buildCookie(response.cookies);
        const sessKey = new URL(response.redirectUrl, this.url).searchParams.get('r');
        if (sessKey) {
          await this.login2(cookie, sessKey);
          this.cookie = cookie;
          return true;
        }
        throw new Error('获取SSO凭据失败，sess_key获取失败');
      }
      throw new Error('获取SSO凭据失败，获取cookie失败');
    }
    if (response.body.length > 3 && response.body.length < 50) throw new Error('获取SSO凭据失败 (' + this.htmlspecialchars(response.body) + ')');
    throw new Error('获取SSO凭据失败 (httpCode=' + response.code + ')');
  }

  private async login2(cookie: string, sessKey: string): Promise<boolean> {
    const s = createHash('md5').update(sessKey + this.username + sessKey + this.skey).digest('hex');
    const url = this.url + this.path + '/index.php?c=sso&a=login&name=' + this.username + '&r=' + sessKey + '&s=' + s;
    const response = await this.request(url, 'GET', { cookie });
    if (response.code === 302) return true;
    if (response.body.length > 3 && response.body.length < 50) throw new Error('SSO登录失败 (' + this.htmlspecialchars(response.body) + ')');
    throw new Error('SSO登录失败 (httpCode=' + response.code + ')');
  }

  private async loginVhost(name: string): Promise<void> {
    const url = this.url + this.path + '/index.php?c=vhost&a=impLogin&name=' + name;
    const response = await this.request(url, 'GET', { cookie: this.cookie });
    if (response.code === 302) {
      await this.request(this.url + '/vhost/', 'GET', { cookie: this.cookie });
    } else {
      throw new Error('用户面板登录失败 (httpCode=' + response.code + ')');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}