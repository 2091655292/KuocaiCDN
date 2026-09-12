import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { domainToASCII } from 'node:url';
import { randomBytes } from 'node:crypto';
import { configGet } from '../../config.js';

export class EnhanceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeHostname(hostname: any): string {
  const raw = String(hostname ?? '').trim();
  if (!raw) return '';
  const trimmed = raw.replace(/\.+$/, '');
  const ascii = domainToASCII(trimmed);
  return (ascii || trimmed).toLowerCase();
}

async function getDispatcher(proxy: boolean): Promise<any> {
  if (!proxy) return undefined;
  const server = String((await configGet('proxy_server', '')) || '').trim();
  const port = Number((await configGet('proxy_port', '')) || 0);
  if (!server || !port) throw new EnhanceError('代理服务器或端口未配置', 400);
  const user = String((await configGet('proxy_user', '')) || '').trim();
  const pwd = String((await configGet('proxy_pwd', '')) || '').trim();
  const type = String((await configGet('proxy_type', '')) || 'http').trim();
  let scheme = 'http';
  if (type === 'https') scheme = 'https';
  else if (type === 'sock4' || type === 'socks4') scheme = 'socks4';
  else if (type === 'sock5' || type === 'sock5h') scheme = 'socks5';
  const authPart = user && pwd ? `${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@` : '';
  return new ProxyAgent(`${scheme}://${authPart}${server}:${port}`);
}

export class CloudflareEnhanceService {
  private email: string;
  private apiKey: string;
  private auth: number;
  private proxy: boolean;
  private accountId: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(config: Record<string, any> = {}) {
    this.email = String(config.email ?? '').trim();
    this.apiKey = String(config.apikey ?? '').trim().replace(/\s+/g, '');
    this.auth = config.auth !== undefined ? Number(config.auth) : /^[0-9a-f]+$/i.test(this.apiKey) ? 0 : 1;
    this.proxy = String(config.proxy ?? '') === '1';
    this.accountId = String(config.account_id ?? '').trim();
  }

  isApiTokenAuth(): boolean {
    return this.auth === 1;
  }

  private normalize(obj: any): any {
    return normalizeHostname(obj);
  }

  async getAccounts(): Promise<any[]> {
    try {
      return await this.paginate('/accounts', {}, 50);
    } catch (e: any) {
      this.throwActionError('获取账户列表', e, 'Account:Read');
    }
  }

  async getDefaultAccountId(): Promise<string> {
    try {
      const accounts = await this.getAccounts();
      if (accounts[0]?.id) return String(accounts[0].id).trim();
    } catch {}

    try {
      const payload = await this.requestRaw('GET', '/zones', { page: 1, per_page: 1 });
      const accountId = String(payload?.result?.[0]?.account?.id ?? '').trim();
      if (accountId) return accountId;
    } catch {}

    return '';
  }

  async getZone(zoneId: string): Promise<any> {
    try {
      return await this.requestResult('GET', '/zones/' + zoneId);
    } catch (e: any) {
      this.throwActionError('获取域名详情', e, 'Zone:Read');
    }
  }

  async listCustomHostnames(zoneId: string): Promise<any[]> {
    try {
      return await this.paginate('/zones/' + zoneId + '/custom_hostnames', {}, 100);
    } catch (e: any) {
      this.throwActionError('获取自定义主机名列表', e, 'SSL and Certificates:Read');
    }
  }

  async getCustomHostname(zoneId: string, hostnameId: string): Promise<any> {
    try {
      return await this.requestResult('GET', '/zones/' + zoneId + '/custom_hostnames/' + hostnameId.trim());
    } catch (e: any) {
      this.throwActionError('获取自定义主机名详情', e, 'SSL and Certificates:Read');
    }
  }

  async createCustomHostname(
    zoneId: string,
    hostname: string,
    customOriginServer: string | null,
    sslMethod = 'http',
    minTlsVersion = '1.0',
  ): Promise<any> {
    hostname = this.normalize(hostname);
    const payload: any = {
      hostname,
      ssl: {
        method: sslMethod === 'txt' ? 'txt' : 'http',
        type: 'dv',
        settings: { min_tls_version: minTlsVersion },
      },
    };
    const origin = String(customOriginServer ?? '').trim();
    if (origin) payload.custom_origin_server = this.normalize(origin);

    try {
      return await this.requestResult('POST', '/zones/' + zoneId + '/custom_hostnames', {}, payload);
    } catch (e: any) {
      this.throwActionError('创建自定义主机名', e, 'SSL and Certificates:Write');
    }
  }

  async updateCustomHostname(zoneId: string, hostnameId: string, payload: any): Promise<any> {
    if (payload.custom_origin_server !== undefined && payload.custom_origin_server !== null) {
      payload.custom_origin_server = this.normalize(payload.custom_origin_server);
    }
    if (payload.hostname !== undefined && payload.hostname !== null) {
      payload.hostname = this.normalize(payload.hostname);
    }

    try {
      return await this.requestResult('PATCH', '/zones/' + zoneId + '/custom_hostnames/' + hostnameId.trim(), {}, payload);
    } catch (e: any) {
      this.throwActionError('更新自定义主机名', e, 'SSL and Certificates:Write');
    }
  }

  async deleteCustomHostname(zoneId: string, hostnameId: string): Promise<boolean> {
    try {
      await this.requestResult('DELETE', '/zones/' + zoneId + '/custom_hostnames/' + hostnameId);
      return true;
    } catch (e: any) {
      this.throwActionError('删除自定义主机名', e, 'SSL and Certificates:Write');
    }
  }

  async getFallbackOrigin(zoneId: string): Promise<string> {
    try {
      const result = await this.requestResult('GET', '/zones/' + zoneId + '/custom_hostnames/fallback_origin', {}, null, true);
      if (result === null) return '';
      return String(result.origin ?? '').trim();
    } catch (e: any) {
      if (e.status === 404) return '';
      this.throwActionError('获取 Fallback Origin', e, 'SSL and Certificates:Read');
    }
  }

  async updateFallbackOrigin(zoneId: string, origin: string): Promise<string> {
    try {
      const result = await this.requestResult('PUT', '/zones/' + zoneId + '/custom_hostnames/fallback_origin', {}, {
        origin: this.normalize(origin),
      });
      return String(result?.origin ?? origin).trim();
    } catch (e: any) {
      this.throwActionError('更新 Fallback Origin', e, 'SSL and Certificates:Write');
    }
  }

  async deleteFallbackOrigin(zoneId: string): Promise<boolean> {
    try {
      await this.requestResult('DELETE', '/zones/' + zoneId + '/custom_hostnames/fallback_origin', {}, null, true);
      return true;
    } catch (e: any) {
      if (e.status === 404) return true;
      this.throwActionError('删除 Fallback Origin', e, 'SSL and Certificates:Write');
    }
  }

  async getDcvDelegationUuid(zoneId: string): Promise<string> {
    try {
      const result = await this.requestResult('GET', '/zones/' + zoneId + '/dcv_delegation/uuid', {}, null, true);
      if (result === null) return '';
      return String(result.uuid ?? '').trim();
    } catch (e: any) {
      this.throwActionError('获取 DCV 委派 UUID', e, 'SSL and Certificates:Read');
    }
  }

  async listTunnels(accountId: string): Promise<any[]> {
    this.assertTunnelSupported();
    try {
      return await this.paginate('/accounts/' + accountId + '/cfd_tunnel', { is_deleted: 'false' }, 100);
    } catch (e: any) {
      this.throwActionError('获取 Tunnel 列表', e, 'Cloudflare Tunnel:Read');
    }
  }

  async createTunnel(accountId: string, name: string): Promise<any> {
    this.assertTunnelSupported();
    try {
      return await this.requestResult('POST', '/accounts/' + accountId + '/cfd_tunnel', {}, {
        name: name.trim(),
        tunnel_secret: randomBytes(32).toString('base64'),
      });
    } catch (e: any) {
      this.throwActionError('创建 Tunnel', e, 'Cloudflare Tunnel:Write');
    }
  }

  async deleteTunnel(accountId: string, tunnelId: string): Promise<boolean> {
    this.assertTunnelSupported();
    try {
      await this.requestResult('DELETE', '/accounts/' + accountId + '/cfd_tunnel/' + tunnelId);
      return true;
    } catch (e: any) {
      this.throwActionError('删除 Tunnel', e, 'Cloudflare Tunnel:Write');
    }
  }

  async getTunnelToken(accountId: string, tunnelId: string): Promise<string> {
    this.assertTunnelSupported();
    try {
      const result = await this.requestResult('GET', '/accounts/' + accountId + '/cfd_tunnel/' + tunnelId + '/token');
      if (typeof result === 'string') return result;
      return String(result?.token ?? '').trim();
    } catch (e: any) {
      this.throwActionError('获取 Tunnel Token', e, 'Cloudflare Tunnel:Read');
    }
  }

  async getTunnelConfig(accountId: string, tunnelId: string): Promise<any> {
    this.assertTunnelSupported();
    try {
      const result = await this.requestResult('GET', '/accounts/' + accountId + '/cfd_tunnel/' + tunnelId + '/configurations', {}, null, true);
      return Array.isArray(result) || result === null ? {} : result;
    } catch (e: any) {
      this.throwActionError('获取 Tunnel 配置', e, 'Cloudflare Tunnel:Read');
    }
  }

  async updateTunnelConfig(accountId: string, tunnelId: string, config: any): Promise<any> {
    this.assertTunnelSupported();
    try {
      return await this.requestResult('PUT', '/accounts/' + accountId + '/cfd_tunnel/' + tunnelId + '/configurations', {}, {
        config,
      });
    } catch (e: any) {
      this.throwActionError('更新 Tunnel 配置', e, 'Cloudflare Tunnel:Write');
    }
  }

  async listCidrRoutes(accountId: string, tunnelId: string | null = null): Promise<any[]> {
    this.assertTunnelSupported();
    const query: Record<string, any> = { is_deleted: 'false' };
    if (tunnelId) query.tunnel_id = tunnelId;

    try {
      return await this.paginate('/accounts/' + accountId + '/teamnet/routes', query, 100);
    } catch (e: any) {
      this.throwActionError('获取 CIDR 路由列表', e, 'Cloudflare Tunnel:Read');
    }
  }

  async createCidrRoute(accountId: string, tunnelId: string, network: string, comment: string | null = null, virtualNetworkId: string | null = null): Promise<any> {
    this.assertTunnelSupported();
    const payload: any = {
      network: network.trim(),
      tunnel_id: tunnelId.trim(),
    };
    if (comment) payload.comment = comment.trim();
    if (virtualNetworkId) payload.virtual_network_id = virtualNetworkId.trim();

    try {
      return await this.requestResult('POST', '/accounts/' + accountId + '/teamnet/routes', {}, payload);
    } catch (e: any) {
      this.throwActionError('创建 CIDR 路由', e, 'Cloudflare Tunnel:Write');
    }
  }

  async deleteCidrRoute(accountId: string, routeId: string): Promise<boolean> {
    this.assertTunnelSupported();
    try {
      await this.requestResult('DELETE', '/accounts/' + accountId + '/teamnet/routes/' + routeId);
      return true;
    } catch (e: any) {
      this.throwActionError('删除 CIDR 路由', e, 'Cloudflare Tunnel:Write');
    }
  }

  async listHostnameRoutes(accountId: string, tunnelId: string | null = null): Promise<any[]> {
    this.assertTunnelSupported();
    const query: Record<string, any> = { is_deleted: 'false' };
    if (tunnelId) query.tunnel_id = tunnelId;

    try {
      return await this.paginate('/accounts/' + accountId + '/zerotrust/routes/hostname', query, 100);
    } catch (e: any) {
      this.throwActionError('获取主机名路由列表', e, 'Cloudflare Tunnel:Read');
    }
  }

  async createHostnameRoute(accountId: string, tunnelId: string, hostname: string, comment: string | null = null): Promise<any> {
    this.assertTunnelSupported();
    const payload: any = {
      hostname: this.normalize(hostname),
      tunnel_id: tunnelId.trim(),
    };
    if (comment) payload.comment = comment.trim();

    try {
      return await this.requestResult('POST', '/accounts/' + accountId + '/zerotrust/routes/hostname', {}, payload);
    } catch (e: any) {
      this.throwActionError('创建主机名路由', e, 'Cloudflare Tunnel:Write');
    }
  }

  async deleteHostnameRoute(accountId: string, routeId: string): Promise<boolean> {
    this.assertTunnelSupported();
    try {
      await this.requestResult('DELETE', '/accounts/' + accountId + '/zerotrust/routes/hostname/' + routeId);
      return true;
    } catch (e: any) {
      this.throwActionError('删除主机名路由', e, 'Cloudflare Tunnel:Write');
    }
  }

  async upsertTunnelCnameRecord(zoneId: string, hostname: string, tunnelId: string): Promise<any> {
    zoneId = zoneId.trim();
    hostname = this.normalize(hostname);
    const target = (tunnelId.trim() + '.cfargotunnel.com').toLowerCase();

    try {
      const payload = await this.requestRaw('GET', '/zones/' + zoneId + '/dns_records', {
        name: hostname,
        type: 'CNAME',
        page: 1,
        per_page: 100,
      });
      const records: any[] = payload?.result ?? [];

      const allByNamePayload = await this.requestRaw('GET', '/zones/' + zoneId + '/dns_records', {
        name: hostname,
        page: 1,
        per_page: 100,
      });
      const allByName: any[] = allByNamePayload?.result ?? [];
      const otherTypes: string[] = [];
      for (const row of allByName) {
        const type = String(row.type ?? '').toUpperCase();
        const name = this.normalize(row.name);
        if (name === hostname && type !== 'CNAME') otherTypes.push(type);
      }
      if (otherTypes.length) {
        throw new EnhanceError(`主机名已存在非 CNAME 记录（${[...new Set(otherTypes)].join(', ')}），无法同步 Tunnel CNAME`, 400);
      }

      for (const record of records) {
        const name = this.normalize(record.name);
        if (name !== hostname) continue;
        const content = this.normalize(record.content);
        const proxied = Boolean(record.proxied);
        if (content === this.normalize(target) && proxied) {
          return { action: 'unchanged' };
        }

        await this.requestResult('PUT', '/zones/' + zoneId + '/dns_records/' + record.id, {}, {
          type: 'CNAME',
          name: hostname,
          content: target,
          proxied: true,
          ttl: 1,
        });
        return { action: 'updated' };
      }

      await this.requestResult('POST', '/zones/' + zoneId + '/dns_records', {}, {
        type: 'CNAME',
        name: hostname,
        content: target,
        proxied: true,
        ttl: 1,
      });
      return { action: 'created' };
    } catch (e: any) {
      this.throwActionError('同步 Tunnel CNAME 记录', e, 'Zone:DNS:Edit');
    }
  }

  async deleteTunnelCnameRecordIfMatch(zoneId: string, hostname: string, tunnelId: string): Promise<any> {
    zoneId = zoneId.trim();
    hostname = this.normalize(hostname);
    const target = this.normalize(tunnelId.trim() + '.cfargotunnel.com');

    try {
      const payload = await this.requestRaw('GET', '/zones/' + zoneId + '/dns_records', {
        name: hostname,
        type: 'CNAME',
        page: 1,
        per_page: 100,
      });
      const records: any[] = payload?.result ?? [];
      for (const record of records) {
        const name = this.normalize(record.name);
        const content = this.normalize(record.content);
        if (name === hostname && content === target) {
          await this.requestResult('DELETE', '/zones/' + zoneId + '/dns_records/' + record.id);
          return { deleted: true };
        }
      }
      return { deleted: false };
    } catch (e: any) {
      this.throwActionError('删除 Tunnel CNAME 记录', e, 'Zone:DNS:Edit');
    }
  }

  private async paginate(path: string, query: Record<string, any> = {}, perPage = 100): Promise<any[]> {
    const all: any[] = [];
    let page = 1;
    const maxPage = 200;
    while (page <= maxPage) {
      const payload = await this.requestRaw('GET', path, { ...query, page, per_page: perPage });
      let batch: any[] = payload?.result ?? [];
      if (!Array.isArray(batch)) batch = [];
      all.push(...batch);

      const totalPages = Number(payload?.result_info?.total_pages ?? 0);
      if (totalPages > 0) {
        if (page >= totalPages) break;
      } else if (batch.length < perPage || batch.length === 0) {
        break;
      }
      page++;
    }
    return all;
  }

  private async requestResult(method: any, path: string, query: Record<string, any> = {}, body: any = null, allowNotFound = false): Promise<any> {
    const payload = await this.requestRaw(method, path, query, body, allowNotFound);
    if (payload === null) return null;
    return payload.result ?? {};
  }

  private async requestRaw(method: any, path: string, query: Record<string, any> = {}, body: any = null, allowNotFound = false): Promise<any> {
    const headers = this.buildHeaders(body !== null);
    let url = this.baseUrl + path;
    if (Object.keys(query).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === null || v === undefined || v === '') continue;
        qs.set(k, String(v));
      }
      if (qs.toString()) url += '?' + qs.toString();
    }

    let status = 0;
    let text = '';
    try {
      const dispatcher = await getDispatcher(this.proxy);
      const res: any = await undiciFetch(url, {
        method: String(method).toUpperCase(),
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
        dispatcher,
      } as any);
      status = res.status;
      text = await res.text();
    } catch (e: any) {
      throw new EnhanceError('Cloudflare API 请求失败：' + (e?.message || '网络错误'), 502);
    }

    if (allowNotFound && status === 404) return null;

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new EnhanceError('Cloudflare 返回数据解析失败', status > 0 ? status : 502);
    }

    if (payload?.success !== true) {
      if (allowNotFound && status === 404) return null;
      const message = this.extractErrorMessage(payload);
      throw new EnhanceError(message || 'Cloudflare API 请求失败', status > 0 ? status : 400);
    }

    return payload;
  }

  private buildHeaders(json: boolean): Record<string, string> {
    if (!this.apiKey) {
      throw new EnhanceError('Cloudflare API 凭证为空', 400);
    }

    const headers: Record<string, string> = {};
    if (this.auth === 1) {
      headers.Authorization = 'Bearer ' + this.apiKey;
    } else {
      if (!this.email) {
        throw new EnhanceError('当前 Cloudflare 账户缺少邮箱地址，旧版 API Key 认证需要填写邮箱', 400);
      }
      headers['X-Auth-Email'] = this.email;
      headers['X-Auth-Key'] = this.apiKey;
    }

    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private assertTunnelSupported(): void {
    if (!this.isApiTokenAuth()) {
      throw new EnhanceError('Cloudflare Tunnels 仅支持 API 令牌认证，请将当前账户的认证方式切换为 API令牌', 400);
    }
  }

  private extractErrorMessage(payload: any): string {
    if (payload?.errors?.[0]?.message) return String(payload.errors[0].message).trim();
    if (payload?.messages?.[0]?.message) return String(payload.messages[0].message).trim();
    if (payload?.result?.message) return String(payload.result.message).trim();
    return '';
  }

  private throwActionError(action: string, e: any, permissionHint = ''): never {
    const status = Number(e?.status ?? e?.code ?? 0);
    let message = String(e?.message ?? '').trim();

    if (status === 401) {
      message = 'Cloudflare 凭证无效或已过期，无法' + action;
    } else if (status === 403) {
      message = 'Cloudflare 权限不足，无法' + action;
      if (permissionHint) message += '。请确认 Token 具备 ' + permissionHint + ' 权限';
    } else if (status === 404 && !message) {
      message = action + '失败：资源不存在';
    } else if (status === 429) {
      message = 'Cloudflare API 请求过于频繁，暂时无法' + action + '，请稍后重试';
    } else if (status >= 500) {
      message = 'Cloudflare 服务暂时不可用，无法' + action + '，请稍后重试';
    } else if (!message) {
      message = action + '失败';
    }

    throw new EnhanceError(message, status > 0 ? status : 400);
  }
}

export { normalizeHostname };

export function checkDomainFormat(domain: string): boolean {
  if (!domain) return false;
  if (domain.length < 4 || domain.length > 512) return false;
  if (!/^[-$a-z0-9_*.]{2,512}$/i.test(domain)) return false;
  if (!domain.includes('.')) return false;
  if (domain.endsWith('.') || domain.startsWith('.')) return false;
  if (domain.startsWith('*') && domain[1] !== '.') return false;
  const starCount = (domain.match(/\*/g) || []).length;
  if (starCount > 1) return false;
  if (starCount === 1 && domain.indexOf('*') > 0) return false;
  return true;
}

export function isValidCidr(network: string): boolean {
  if (!network.includes('/')) return false;
  const [ip, prefixStr] = network.split('/', 2);
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    if (v4.slice(1).some((s) => Number(s) > 255)) return false;
    return prefix <= 32;
  }
  if (ip.includes(':')) {
    return prefix <= 128;
  }
  return false;
}
