import type { DeployProvider } from '../types.js';

export class NginxProxyManagerDeploy implements DeployProvider {
  private url: string;
  private email: string;
  private password: string;
  private token: string | null = null;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.email = String(config.email || '').trim();
    this.password = config.password || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(method: string, path: string, params: any = null, auth = true, extraHeaders: Record<string, string> = {}, isMultipart = false): Promise<any> {
    const headers: Record<string, string> = { ...extraHeaders };
    let body: any;
    if (isMultipart) {
      body = params;
    } else if (params !== null && method.toUpperCase() !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }
    if (auth) {
      if (!this.token) throw new Error('NPM 访问令牌不存在，请先登录');
      headers.Authorization = 'Bearer ' + this.token;
    }
    const res = await fetch(this.url + '/api' + path, { method, headers, body });
    const text = await res.text();
    let result: any;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }
    if (res.status >= 200 && res.status < 300) return result;
    if (result?.error?.message) throw new Error(result.error.message);
    if (result?.message) throw new Error(result.message);
    if (typeof result?.error === 'string' && result.error) throw new Error(result.error);
    throw new Error('请求失败(httpCode=' + res.status + '): ' + text.slice(0, 300));
  }

  private async login(): Promise<void> {
    const data = await this.request('POST', '/tokens', { identity: this.email, secret: this.password }, false);
    if (!data?.token) {
      if (data?.requires_2fa) throw new Error('当前 NPM 账户启用了双因素认证，暂不支持');
      throw new Error('登录 NPM 失败，未返回访问令牌');
    }
    this.token = data.token;
  }

  private domainMatches(pattern: string, domain: string): boolean {
    pattern = pattern.trim().toLowerCase();
    domain = domain.trim().toLowerCase();
    if (!pattern || !domain) return false;
    if (pattern === domain) return true;
    if (pattern.startsWith('*.')) return domain.endsWith(pattern.slice(1));
    return false;
  }

  private hasIntersectDomain(domains: string[], hostDomains: string[]): boolean {
    for (const hd of hostDomains) {
      if (!hd.trim()) continue;
      for (const d of domains) {
        if (this.domainMatches(d, hd) || this.domainMatches(hd, d)) return true;
      }
    }
    return false;
  }

  private splitFullchain(fullchain: string): [string, string] {
    const matches = fullchain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    const certs = matches.map((m) => m.trim()).filter(Boolean);
    if (!certs.length) throw new Error('证书内容格式错误，未找到 PEM 证书块');
    const certificate = certs[0] + '\n';
    const intermediate = certs.length > 1 ? certs.slice(1).join('\n') + '\n' : '';
    return [certificate, intermediate];
  }

  async check(): Promise<void> {
    if (!this.url || !this.email || !this.password) throw new Error('请填写面板地址、登录邮箱和登录密码');
    await this.login();
    await this.request('GET', '/nginx/certificates');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    const domains = (config.domainList || []).filter(Boolean).map((d: string) => d.trim());
    if (!domains.length) throw new Error('没有设置要部署的域名');

    await this.login();

    const certificateId = Number(config.id || 0);
    if (certificateId > 0) {
      this.log('使用配置中的证书ID:' + certificateId + ' 直接更新 NPM 自定义证书');
      const certificate = await this.request('GET', '/nginx/certificates/' + certificateId);
      if (certificate?.provider !== 'other') throw new Error('证书ID:' + certificateId + ' 不是自定义证书(provider=other)，无法通过上传接口更新');
      await this.uploadCertificate(certificateId, fullchain, privatekey);
      this.log('证书ID:' + certificateId + ' 更新成功！');
      return;
    }

    const hostId = Number(config.host_id || 0);
    let hosts: any[] = [];
    if (hostId > 0) {
      const h = await this.request('GET', '/nginx/proxy-hosts/' + hostId);
      if (!h?.id) throw new Error('Proxy Host ID:' + hostId + ' 不存在');
      hosts = [h];
    } else {
      const list = await this.request('GET', '/nginx/proxy-hosts');
      for (const host of list || []) {
        if (this.hasIntersectDomain(domains, host.domain_names || [])) {
          const h = await this.request('GET', '/nginx/proxy-hosts/' + host.id);
          if (h?.id) hosts.push(h);
        }
      }
    }
    if (!hosts.length) throw new Error('未找到匹配的 Proxy Host，请填写证书ID或 Proxy Host ID');

    this.log('匹配到 Proxy Host ' + hosts.length + ' 个');

    let resolvedId = 0;
    for (const host of hosts) {
      const cid = Number(host.certificate_id || 0);
      if (cid <= 0) continue;
      try {
        const cert = await this.request('GET', '/nginx/certificates/' + cid);
        if (cert?.provider !== 'other') throw new Error('不是自定义证书');
        if (resolvedId === 0) resolvedId = cid;
        else if (resolvedId !== cid) throw new Error('匹配到多个 Proxy Host，但它们绑定了不同的自定义证书ID，无法自动决定更新哪个证书，请手动填写证书ID');
      } catch (e: any) {
        if (e.message.includes('不同的自定义证书')) throw e;
        this.log('Proxy Host ID:' + host.id + ' 当前证书不可直接更新：' + e.message);
      }
    }

    if (resolvedId === 0) {
      const created = await this.request('POST', '/nginx/certificates', { provider: 'other', nice_name: domains[0] });
      resolvedId = Number(created?.id || 0);
      if (resolvedId <= 0) throw new Error('创建 NPM 自定义证书失败');
      this.log('创建自定义证书成功，证书ID:' + resolvedId);
    }

    await this.uploadCertificate(resolvedId, fullchain, privatekey);
    this.log('证书ID:' + resolvedId + ' 更新成功！');

    for (const host of hosts) {
      if (Number(host.certificate_id || 0) !== resolvedId) {
        await this.request('PUT', '/nginx/proxy-hosts/' + host.id, { certificate_id: resolvedId });
        this.log('Proxy Host ID:' + host.id + ' 已绑定到证书ID:' + resolvedId);
      }
    }

    if (!info.config) info.config = {};
    info.config.id = String(resolvedId);
  }

  private async uploadCertificate(certificateId: number, fullchain: string, privatekey: string): Promise<void> {
    const [certificate, intermediate] = this.splitFullchain(fullchain);
    const form = new FormData();
    form.append('certificate', new Blob([certificate]), 'certificate.pem');
    form.append('certificate_key', new Blob([privatekey]), 'certificate.key');
    if (intermediate) {
      form.append('intermediate_certificate', new Blob([intermediate]), 'intermediate.pem');
    }
    await this.request('POST', `/nginx/certificates/${certificateId}/upload`, form, true, {}, true);
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}