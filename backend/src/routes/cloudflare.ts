import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { dnsProviders } from '../lib/dns/factory.js';
import {
  CloudflareEnhanceService,
  EnhanceError,
  checkDomainFormat,
  isValidCidr,
  normalizeHostname,
} from '../lib/cloudflare/enhance.js';
import { fmtDateTime } from '../lib/util.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

interface DomainCtx {
  domain: any;
  account: any;
  config: Record<string, any>;
  service: CloudflareEnhanceService;
}

async function getCloudflareDomainContext(domainId: number): Promise<DomainCtx> {
  const row: any = await queryOne(
    `SELECT A.*, B.type AS account_type, B.config AS account_config, B.name AS account_name, B.remark AS account_remark
     FROM ${table('domain')} A LEFT JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
    [domainId],
  );
  if (!row) throw new EnhanceError('域名不存在');
  if (row.account_type !== 'cloudflare') throw new EnhanceError('仅支持 Cloudflare 域名');
  if (!row.thirdid) throw new EnhanceError('当前域名缺少 Cloudflare Zone ID');

  const config = safeJson(row.account_config) || {};
  return { domain: row, account: null as any, config, service: new CloudflareEnhanceService(config) };
}

interface AccountCtx {
  account: any;
  config: Record<string, any>;
  service: CloudflareEnhanceService;
  accountId: string;
}

async function getCloudflareAccountContext(
  accountId: number,
  requireAccountId = false,
  requireTunnelApiToken = false,
): Promise<AccountCtx> {
  const account: any = await queryOne(`SELECT * FROM ${table('account')} WHERE id = ?`, [accountId]);
  if (!account) throw new EnhanceError('域名账户不存在');
  if (account.type !== 'cloudflare') throw new EnhanceError('仅支持 Cloudflare 账户');

  const config = safeJson(account.config) || {};
  let service = new CloudflareEnhanceService(config);
  if (requireTunnelApiToken && !service.isApiTokenAuth()) {
    throw new EnhanceError('Cloudflare Tunnels 仅支持 API 令牌认证，请将当前账户的认证方式切换为 API令牌');
  }

  let resolvedAccountId = String(config.account_id ?? '').trim();
  if (requireAccountId && !resolvedAccountId) {
    resolvedAccountId = await service.getDefaultAccountId();
    if (resolvedAccountId) {
      config.account_id = resolvedAccountId;
      await query(`UPDATE ${table('account')} SET config = ? WHERE id = ?`, [JSON.stringify(config), account.id]);
      account.config = JSON.stringify(config);
      service = new CloudflareEnhanceService(config);
    }
  }
  if (requireAccountId && !resolvedAccountId) {
    throw new EnhanceError('当前 Cloudflare 账户缺少 Account ID，且无法自动探测。请编辑账户并补充 Account ID 后重试');
  }

  return { account, config, service, accountId: resolvedAccountId };
}

function validateCustomOrigin(origin: string): void {
  if (/^https?:\/\//i.test(origin)) throw new EnhanceError('自定义源站不支持填写 http:// 或 https://');
  if (origin.includes('*')) throw new EnhanceError('自定义源站不支持通配符');
  if (origin.includes('/')) throw new EnhanceError('自定义源站格式不正确');
  if (/:\d+$/.test(origin)) throw new EnhanceError('自定义源站不支持端口');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(origin);
  if (v4 || origin.includes(':')) throw new EnhanceError('自定义源站不支持 IP 地址，请填写域名');
  if (!checkDomainFormat(origin)) throw new EnhanceError('自定义源站格式不正确');
}

function extractCustomHostnameSslPayload(row: any, sslMethod = '', minTlsVersion = ''): any {
  const ssl = row?.ssl && typeof row.ssl === 'object' ? row.ssl : {};
  const payload: any = {
    method: sslMethod !== '' ? sslMethod : String(ssl.method ?? 'http').trim(),
    type: String(ssl.type ?? 'dv').trim(),
  };
  if (!payload.method) payload.method = 'http';
  if (!payload.type) payload.type = 'dv';

  if (minTlsVersion !== '') {
    payload.settings = { min_tls_version: minTlsVersion };
  } else if (ssl.settings && typeof ssl.settings === 'object') {
    payload.settings = ssl.settings;
  }
  return payload;
}

function formatCustomHostnameRow(row: any): any {
  const ssl = row?.ssl && typeof row.ssl === 'object' ? row.ssl : {};
  const ownership = row?.ownership_verification && typeof row.ownership_verification === 'object' ? row.ownership_verification : {};
  const ownershipHttp = row?.ownership_verification_http && typeof row.ownership_verification_http === 'object' ? row.ownership_verification_http : {};
  let verificationStatus = String(ownership.http?.status ?? ownership.txt?.status ?? ownership.status ?? '').trim();
  if (
    !verificationStatus &&
    (String(ownership.name ?? '').trim() || String(ownership.value ?? '').trim() || String(ownershipHttp.http_url ?? '').trim() || String(ownershipHttp.http_body ?? '').trim())
  ) {
    verificationStatus = 'pending';
  }

  const validationErrors: string[] = [];
  if (Array.isArray(row?.verification_errors)) {
    for (const item of row.verification_errors) {
      const message = String(item?.message ?? item ?? '').trim();
      if (message) validationErrors.push(message);
    }
  }
  if (Array.isArray(ssl?.validation_errors)) {
    for (const item of ssl.validation_errors) {
      const message = String(item?.message ?? item ?? '').trim();
      if (message) validationErrors.push(message);
    }
  }

  const sslValidationRecords: any[] = [];
  if (Array.isArray(ssl?.validation_records)) {
    for (const item of ssl.validation_records) {
      if (!item || typeof item !== 'object') continue;
      sslValidationRecords.push({
        status: String(item.status ?? '').trim(),
        txt_name: String(item.txt_name ?? '').trim(),
        txt_value: String(item.txt_value ?? '').trim(),
        cname_name: String(item.cname_name ?? '').trim(),
        cname_target: String(item.cname_target ?? '').trim(),
        http_url: String(item.http_url ?? '').trim(),
        http_body: String(item.http_body ?? '').trim(),
        emails: Array.isArray(item.emails) ? item.emails.map((s: any) => String(s)).filter(Boolean) : [],
      });
    }
  }
  if (
    !sslValidationRecords.length &&
    (String(ssl.txt_name ?? '').trim() ||
      String(ssl.txt_value ?? '').trim() ||
      String(ssl.cname_name ?? '').trim() ||
      String(ssl.cname_target ?? '').trim() ||
      String(ssl.http_url ?? '').trim() ||
      String(ssl.http_body ?? '').trim())
  ) {
    sslValidationRecords.push({
      status: String(ssl.status ?? '').trim(),
      txt_name: String(ssl.txt_name ?? '').trim(),
      txt_value: String(ssl.txt_value ?? '').trim(),
      cname_name: String(ssl.cname_name ?? '').trim(),
      cname_target: String(ssl.cname_target ?? '').trim(),
      http_url: String(ssl.http_url ?? '').trim(),
      http_body: String(ssl.http_body ?? '').trim(),
      emails: [],
    });
  }

  const statuses = [...new Set(sslValidationRecords.map((item) => String(item.status ?? '').trim()).filter(Boolean))];
  let sslValidationStatus = statuses.length ? statuses.join(' / ') : String(ssl.status ?? '').trim();
  if (!sslValidationStatus) sslValidationStatus = '-';

  return {
    id: String(row?.id ?? '').trim(),
    hostname: String(row?.hostname ?? '').trim(),
    custom_origin_server: String(row?.custom_origin_server ?? '').trim(),
    status: String(row?.status ?? '').trim(),
    ssl,
    ssl_status: String(ssl.status ?? '').trim(),
    ssl_method: String(ssl.method ?? '').trim(),
    ssl_min_tls_version: String(ssl.settings?.min_tls_version ?? '').trim(),
    ssl_type: String(ssl.type ?? '').trim(),
    ssl_validation_status: sslValidationStatus,
    verification_status: verificationStatus || '-',
    created_on: String(row?.created_at ?? row?.created_on ?? '').trim(),
    validation_errors: [...new Set(validationErrors.filter(Boolean))].join(' | '),
    ownership_verification: {
      type: String(ownership.type ?? '').trim(),
      name: String(ownership.name ?? '').trim(),
      value: String(ownership.value ?? '').trim(),
      status: verificationStatus || '-',
    },
    ownership_verification_http: {
      http_url: String(ownershipHttp.http_url ?? '').trim(),
      http_body: String(ownershipHttp.http_body ?? '').trim(),
    },
    ssl_validation_records: sslValidationRecords,
  };
}

function formatTunnelRow(row: any): any {
  const connections = Array.isArray(row?.connections) ? row.connections : [];
  return {
    id: String(row?.id ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    status: String(row?.status ?? 'unknown').trim(),
    created_at: String(row?.created_at ?? '').trim(),
    deleted_at: String(row?.deleted_at ?? '').trim(),
    conns_active_at: String(row?.conns_active_at ?? '').trim(),
    connection_count: connections.length,
    connections,
  };
}

function formatCidrRouteRow(row: any): any {
  return {
    id: String(row?.id ?? '').trim(),
    network: String(row?.network ?? '').trim(),
    comment: String(row?.comment ?? '').trim(),
    virtual_network_id: String(row?.virtual_network_id ?? '').trim(),
    tunnel_id: String(row?.tunnel_id ?? '').trim(),
    created_at: String(row?.created_at ?? '').trim(),
  };
}

function formatHostnameRouteRow(row: any): any {
  return {
    id: String(row?.id ?? row?.hostname_route_id ?? '').trim(),
    hostname: String(row?.hostname ?? row?.hostname_pattern ?? '').trim(),
    comment: String(row?.comment ?? '').trim(),
    tunnel_id: String(row?.tunnel_id ?? '').trim(),
    created_at: String(row?.created_at ?? '').trim(),
  };
}

function matchHostnameToDomainRecordName(hostname: string, domainName: string, allowRelative = false): string | null {
  hostname = normalizeHostname(hostname).replace(/^\*\./, '');
  domainName = normalizeHostname(domainName);
  if (!hostname || !domainName) return null;
  if (hostname === domainName) return '@';
  if (hostname.endsWith('.' + domainName)) return hostname.slice(0, hostname.length - domainName.length - 1);
  if (allowRelative) {
    if (hostname === '@') return '@';
    if (!hostname.includes('.')) return hostname;
  }
  return null;
}

function formatAccountDisplayName(account: any): string {
  const name = String(account?.name ?? '').trim();
  const remark = String(account?.remark ?? '').trim();
  if (remark) return `${remark} (${name})`;
  return name || 'Cloudflare账户#' + (account?.id ?? '');
}

function formatTxtTargetCandidate(row: any, recordName: string, currentDomainId: number): any {
  const accountType = String(row.account_type ?? '').trim();
  const dnsMeta = dnsProviders[accountType];
  const account = {
    id: Number(row.aid ?? 0),
    name: String(row.account_name ?? '').trim(),
    remark: String(row.account_remark ?? '').trim(),
  };
  return {
    domain_id: Number(row.id ?? 0),
    domain_name: String(row.name ?? '').trim(),
    record_name: recordName,
    account_id: account.id,
    account_type: accountType,
    account_type_name: dnsMeta ? dnsMeta.name : accountType || '-',
    account_display_name: formatAccountDisplayName(account),
    is_current_domain: Number(row.id ?? 0) === currentDomainId,
  };
}

async function findTxtRecordTargetDomains(currentDomain: any, hostname: string): Promise<any[]> {
  const rows: any[] = await query(
    `SELECT D.id, D.aid, D.name, A.type AS account_type, A.name AS account_name, A.remark AS account_remark
     FROM ${table('domain')} D LEFT JOIN ${table('account')} A ON D.aid = A.id`,
  );

  const candidates: any[] = [];
  let bestLength = -1;
  for (const row of rows) {
    const recordName = matchHostnameToDomainRecordName(hostname, String(row.name ?? ''));
    if (recordName === null) continue;
    const domainName = normalizeHostname(row.name);
    const matchedLength = domainName.length;
    if (matchedLength > bestLength) {
      bestLength = matchedLength;
      candidates.length = 0;
    }
    if (matchedLength === bestLength) {
      candidates.push(formatTxtTargetCandidate(row, recordName, Number(currentDomain?.id ?? 0)));
    }
  }

  if (!candidates.length) {
    const fallbackRecordName = matchHostnameToDomainRecordName(hostname, String(currentDomain?.name ?? ''), true);
    if (fallbackRecordName !== null) {
      candidates.push(
        formatTxtTargetCandidate(
          {
            id: currentDomain?.id ?? 0,
            aid: currentDomain?.aid ?? 0,
            name: currentDomain?.name ?? '',
            account_type: currentDomain?.account_type ?? '',
            account_name: currentDomain?.account_name ?? '',
            account_remark: currentDomain?.account_remark ?? '',
          },
          fallbackRecordName,
          Number(currentDomain?.id ?? 0),
        ),
      );
    }
  }

  candidates.sort((a, b) => {
    if (a.is_current_domain !== b.is_current_domain) return a.is_current_domain ? -1 : 1;
    return String(a.account_type_name).localeCompare(String(b.account_type_name)) || String(a.account_display_name).localeCompare(String(b.account_display_name)) || String(a.domain_name).localeCompare(String(b.domain_name));
  });

  return candidates;
}

async function findBestMatchingDomain(accountId: number, hostname: string): Promise<any | null> {
  hostname = normalizeHostname(hostname).replace(/^\*\./, '');
  const domains: any[] = await query(`SELECT * FROM ${table('domain')} WHERE aid = ?`, [accountId]);
  let best: any = null;
  let bestLength = -1;
  for (const domain of domains) {
    const domainName = normalizeHostname(domain.name);
    if (!domainName) continue;
    if (matchHostnameToDomainRecordName(hostname, domainName) !== null && domainName.length > bestLength) {
      best = domain;
      bestLength = domainName.length;
    }
  }
  return best;
}

function extractTunnelConfigObject(raw: any): any {
  if (raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) return raw.config;
  return raw || {};
}

function extractPublicHostnames(config: any): any[] {
  const rows: any[] = [];
  const ingress = Array.isArray(config?.ingress) ? config.ingress : [];
  for (const rule of ingress) {
    if (!rule || typeof rule !== 'object') continue;
    const hostname = String(rule.hostname ?? '').trim();
    if (!hostname) continue;
    rows.push({
      hostname,
      path: String(rule.path ?? '').trim(),
      service: String(rule.service ?? '').trim(),
    });
  }
  return rows;
}

function isFallbackIngressRule(rule: any): boolean {
  return String(rule?.hostname ?? '').trim() === '' && String(rule?.path ?? '').trim() === '';
}

function ensureFallbackIngress(ingress: any[]): any[] {
  const rows = ingress.filter((rule) => rule && typeof rule === 'object');
  if (!rows.length || !isFallbackIngressRule(rows[rows.length - 1])) {
    rows.push({ service: 'http_status:404' });
  }
  return rows;
}

function findFallbackIngressIndex(ingress: any[]): number {
  for (let i = 0; i < ingress.length; i++) {
    if (ingress[i] && typeof ingress[i] === 'object' && isFallbackIngressRule(ingress[i])) return i;
  }
  return -1;
}

function findPublicHostnameIndex(ingress: any[], hostname: string, path: string): number {
  for (let i = 0; i < ingress.length; i++) {
    const rule = ingress[i];
    if (!rule || typeof rule !== 'object') continue;
    if (normalizeHostname(rule.hostname) === normalizeHostname(hostname) && String(rule.path ?? '').trim() === path.trim()) {
      return i;
    }
  }
  return -1;
}

async function addLog(uid: number, domain: string, action: string, data: string): Promise<void> {
  if (data.length > 500) data = data.slice(0, 500);
  await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (?, ?, ?, ?, ?)`, [
    uid,
    domain,
    action,
    data,
    fmtDateTime(new Date()),
  ]);
}

function unwrap(e: any): { code: number; msg: string } {
  if (e instanceof EnhanceError) return { code: -1, msg: e.message };
  return { code: -1, msg: e?.message || '操作失败' };
}

export default async function cloudflareRoutes(app: FastifyInstance) {
  const auth = authenticate(app);
  const admin = (req: any) => {
    if (!checkLevel(req.user, 2)) throw new EnhanceError('无权限', 403);
  };

  // ==================== 自定义主机名 ====================

  app.get('/api/cloudflare/domains/:domainId/hostnames', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const rows = await ctx.service.listCustomHostnames(ctx.domain.thirdid);
      return { code: 0, data: rows.map((row) => formatCustomHostnameRow(row)) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const b = req.body || {};
      const hostname = String(b.hostname ?? '').trim();
      const origin = String(b.custom_origin_server ?? '').trim();
      const sslMethod = String(b.ssl_method ?? 'txt').trim();
      const minTlsVersion = String(b.min_tls_version ?? '1.0').trim();
      if (!hostname || !checkDomainFormat(hostname)) throw new EnhanceError('主机名格式不正确');
      if (!['txt', 'http'].includes(sslMethod)) throw new EnhanceError('证书验证方法无效');
      if (!['1.0', '1.1', '1.2', '1.3'].includes(minTlsVersion)) throw new EnhanceError('最低 TLS 版本无效');
      if (origin) validateCustomOrigin(origin);

      const result = await ctx.service.createCustomHostname(ctx.domain.thirdid, hostname, origin || null, sslMethod, minTlsVersion);
      await addLog(req.user.uid, ctx.domain.name, '创建自定义主机名', `${hostname}${origin ? ' -> ' + origin : ''} (验证: ${sslMethod}, TLS: ${minTlsVersion})`);
      return { code: 0, msg: '创建自定义主机名成功', data: formatCustomHostnameRow(result) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames/batch_add', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const b = req.body || {};
      const hostnamesText = String(b.hostnames ?? '').trim();
      const origin = String(b.custom_origin_server ?? '').trim();
      const sslMethod = String(b.ssl_method ?? 'txt').trim();
      const minTlsVersion = String(b.min_tls_version ?? '1.0').trim();

      if (!hostnamesText) throw new EnhanceError('缺少主机名列表');
      if (!['txt', 'http'].includes(sslMethod)) throw new EnhanceError('证书验证方法无效');
      if (!['1.0', '1.1', '1.2', '1.3'].includes(minTlsVersion)) throw new EnhanceError('最低 TLS 版本无效');
      if (origin) validateCustomOrigin(origin);

      const hostnames = hostnamesText.split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (!hostnames.length) throw new EnhanceError('主机名列表为空');

      let addedCount = 0;
      const failedHostnames: string[] = [];
      for (const hostname of hostnames) {
        if (!checkDomainFormat(hostname)) {
          failedHostnames.push(`${hostname}（格式不正确）`);
          continue;
        }
        try {
          await ctx.service.createCustomHostname(ctx.domain.thirdid, hostname, origin || null, sslMethod, minTlsVersion);
          addedCount++;
          await addLog(req.user.uid, ctx.domain.name, '批量添加自定义主机名', `${hostname}${origin ? ' -> ' + origin : ''} (验证: ${sslMethod}, TLS: ${minTlsVersion})`);
        } catch (e: any) {
          failedHostnames.push(`${hostname}（${e?.message || '失败'}）`);
        }
      }

      let message = `批量添加成功，共添加 ${addedCount} 个自定义主机名`;
      if (failedHostnames.length) message += `，失败 ${failedHostnames.length} 个：${failedHostnames.join('; ')}`;
      return { code: 0, msg: message };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.put('/api/cloudflare/domains/:domainId/hostnames/:hostnameId', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const hostnameId = String(req.params.hostnameId ?? '').trim();
      if (!hostnameId) throw new EnhanceError('缺少 hostname_id');

      const b = req.body || {};
      const current = await ctx.service.getCustomHostname(ctx.domain.thirdid, hostnameId);
      const hostname = String(current?.hostname ?? '').trim();
      const origin = String(b.custom_origin_server ?? '').trim();
      const sslMethod = String(b.ssl_method ?? 'txt').trim();
      const minTlsVersion = String(b.min_tls_version ?? '1.0').trim();
      if (!['txt', 'http'].includes(sslMethod)) throw new EnhanceError('证书验证方法无效');
      if (!['1.0', '1.1', '1.2', '1.3'].includes(minTlsVersion)) throw new EnhanceError('最低 TLS 版本无效');
      if (origin) validateCustomOrigin(origin);

      const result = await ctx.service.updateCustomHostname(ctx.domain.thirdid, hostnameId, {
        custom_origin_server: origin || null,
        ssl: extractCustomHostnameSslPayload(current, sslMethod, minTlsVersion),
      });
      await addLog(req.user.uid, ctx.domain.name, '编辑自定义主机名', `${hostname} -> ${origin || '清空源站'} (验证: ${sslMethod}, TLS: ${minTlsVersion})`);
      return { code: 0, msg: '更新自定义主机名成功', data: formatCustomHostnameRow(result) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames/:hostnameId/refresh', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const hostnameId = String(req.params.hostnameId ?? '').trim();
      if (!hostnameId) throw new EnhanceError('缺少 hostname_id');

      const current = await ctx.service.getCustomHostname(ctx.domain.thirdid, hostnameId);
      const hostname = String(current?.hostname ?? hostnameId).trim();
      const origin = String(current?.custom_origin_server ?? '').trim();
      const result = await ctx.service.updateCustomHostname(ctx.domain.thirdid, hostnameId, {
        custom_origin_server: origin || null,
        ssl: extractCustomHostnameSslPayload(current),
      });
      await addLog(req.user.uid, ctx.domain.name, '刷新自定义主机名验证', hostname);
      return { code: 0, msg: '已向 Cloudflare 重新发起验证', data: formatCustomHostnameRow(result) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/domains/:domainId/hostnames/:hostnameId', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const hostnameId = String(req.params.hostnameId ?? '').trim();
      const hostname = String(req.query.hostname ?? '').trim();
      if (!hostnameId) throw new EnhanceError('缺少 hostname_id');
      await ctx.service.deleteCustomHostname(ctx.domain.thirdid, hostnameId);
      await addLog(req.user.uid, ctx.domain.name, '删除自定义主机名', hostname);
      return { code: 0, msg: '删除自定义主机名成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames/batch_delete', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const hostnameIds: any[] = Array.isArray(req.body?.hostname_ids) ? req.body.hostname_ids : [];
      if (!hostnameIds.length) throw new EnhanceError('缺少 hostname_ids');

      let deletedCount = 0;
      for (const hostnameId of hostnameIds) {
        const id = String(hostnameId ?? '').trim();
        if (!id) continue;
        try {
          const info = await ctx.service.getCustomHostname(ctx.domain.thirdid, id);
          const hostname = String(info?.hostname ?? '').trim();
          await ctx.service.deleteCustomHostname(ctx.domain.thirdid, id);
          deletedCount++;
          await addLog(req.user.uid, ctx.domain.name, '批量删除自定义主机名', hostname);
        } catch {}
      }
      return { code: 0, msg: `批量删除成功，共删除 ${deletedCount} 个自定义主机名` };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames/batch_update', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const b = req.body || {};
      const hostnameIds = String(b.hostname_ids ?? '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (!hostnameIds.length) throw new EnhanceError('缺少 hostname_ids');

      const origin = String(b.custom_origin_server ?? '').trim();
      const sslMethod = String(b.ssl_method ?? '').trim();
      const minTlsVersion = String(b.min_tls_version ?? '').trim();

      if (sslMethod && !['txt', 'http'].includes(sslMethod)) throw new EnhanceError('证书验证方法无效');
      if (minTlsVersion && !['1.0', '1.1', '1.2', '1.3'].includes(minTlsVersion)) throw new EnhanceError('最低 TLS 版本无效');
      if (origin) validateCustomOrigin(origin);

      let updatedCount = 0;
      for (const hostnameId of hostnameIds) {
        try {
          const current = await ctx.service.getCustomHostname(ctx.domain.thirdid, hostnameId);
          const hostname = String(current?.hostname ?? '').trim();
          const payload: any = { custom_origin_server: origin || null };
          if (sslMethod || minTlsVersion) {
            payload.ssl = extractCustomHostnameSslPayload(current, sslMethod, minTlsVersion);
          }
          await ctx.service.updateCustomHostname(ctx.domain.thirdid, hostnameId, payload);
          updatedCount++;
          await addLog(
            req.user.uid,
            ctx.domain.name,
            '批量修改自定义主机名',
            `${hostname} -> ${origin || '清空源站'} (验证: ${sslMethod || '保持不变'}, TLS: ${minTlsVersion || '保持不变'})`,
          );
        } catch {}
      }
      return { code: 0, msg: `批量修改成功，共修改 ${updatedCount} 个自定义主机名` };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/domains/:domainId/hostnames/txt-targets', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const hostname = String(req.body?.hostname ?? '').trim();
      if (!hostname) throw new EnhanceError('缺少 TXT 主机名');
      return {
        code: 0,
        data: {
          hostname,
          candidates: await findTxtRecordTargetDomains(ctx.domain, hostname),
        },
      };
    } catch (e: any) {
      return { ...unwrap(e), data: { candidates: [] } };
    }
  });

  // ==================== Fallback Origin ====================

  app.get('/api/cloudflare/domains/:domainId/fallback', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const origin = await ctx.service.getFallbackOrigin(ctx.domain.thirdid);
      return { code: 0, data: { origin } };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.put('/api/cloudflare/domains/:domainId/fallback', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const origin = String(req.body?.origin ?? '').trim();
      if (!origin) throw new EnhanceError('Fallback Origin 不能为空');
      validateCustomOrigin(origin);

      const savedOrigin = await ctx.service.updateFallbackOrigin(ctx.domain.thirdid, origin);
      await addLog(req.user.uid, ctx.domain.name, '更新 Fallback Origin', savedOrigin);
      return { code: 0, msg: '更新 Fallback Origin 成功', data: { origin: savedOrigin } };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/domains/:domainId/fallback', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      await ctx.service.deleteFallbackOrigin(ctx.domain.thirdid);
      await addLog(req.user.uid, ctx.domain.name, '删除 Fallback Origin', '清空成功');
      return { code: 0, msg: '已清空 Fallback Origin' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  // ==================== DCV 委派 ====================

  app.get('/api/cloudflare/domains/:domainId/dcv-uuid', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareDomainContext(Number(req.params.domainId));
      const uuid = await ctx.service.getDcvDelegationUuid(ctx.domain.thirdid);
      return { code: 0, data: { uuid } };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  // ==================== Tunnel ====================

  app.get('/api/cloudflare/accounts/:accountId/tunnels', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const rows = await ctx.service.listTunnels(ctx.accountId);
      return { code: 0, data: rows.map((row) => formatTunnelRow(row)), account_name: formatAccountDisplayName(ctx.account) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/accounts/:accountId/tunnels', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const name = String(req.body?.name ?? '').trim();
      if (!name) throw new EnhanceError('Tunnel 名称不能为空');
      const tunnel = await ctx.service.createTunnel(ctx.accountId, name);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '创建 Tunnel', `${name} [${tunnel?.id ?? '-'}]`);
      return { code: 0, msg: '创建 Tunnel 成功', data: formatTunnelRow(tunnel) };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      if (!tunnelId) throw new EnhanceError('缺少 tunnel_id');
      await ctx.service.deleteTunnel(ctx.accountId, tunnelId);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '删除 Tunnel', tunnelId);
      return { code: 0, msg: '删除 Tunnel 成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.get('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/token', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      if (!tunnelId) throw new EnhanceError('缺少 tunnel_id');
      const token = await ctx.service.getTunnelToken(ctx.accountId, tunnelId);
      return { code: 0, data: { token } };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.get('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/public-hostnames', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      if (!tunnelId) throw new EnhanceError('缺少 tunnel_id');
      const config = extractTunnelConfigObject(await ctx.service.getTunnelConfig(ctx.accountId, tunnelId));
      const rows: any[] = [];
      for (const row of extractPublicHostnames(config)) {
        const zone = await findBestMatchingDomain(Number(ctx.account.id), row.hostname);
        row.zone_name = zone?.name ?? '';
        row.zone_id = zone?.thirdid ?? '';
        rows.push(row);
      }
      return { code: 0, data: rows };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.put('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/public-hostnames', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const b = req.body || {};
      const hostname = String(b.hostname ?? '').trim();
      const serviceValue = String(b.service ?? '').trim();
      const path = String(b.path ?? '').trim();
      if (!tunnelId || !hostname || !serviceValue) throw new EnhanceError('Tunnel、主机名、服务地址不能为空');
      if (!checkDomainFormat(hostname)) throw new EnhanceError('主机名格式不正确');

      const zone = await findBestMatchingDomain(Number(ctx.account.id), hostname);
      if (!zone || !zone.thirdid) {
        throw new EnhanceError('未找到匹配的本地域名，请先在当前 Cloudflare 账户下导入该主机名所属主域');
      }

      const config = extractTunnelConfigObject(await ctx.service.getTunnelConfig(ctx.accountId, tunnelId));
      const oldConfig = JSON.parse(JSON.stringify(config));
      const ingress = Array.isArray(config?.ingress) ? [...config.ingress] : [];
      const rule: any = { hostname, service: serviceValue };
      if (path) rule.path = path;

      const existingIndex = findPublicHostnameIndex(ingress, hostname, path);
      if (existingIndex >= 0) {
        const next = { ...ingress[existingIndex], ...rule };
        if (!path && 'path' in next) delete next.path;
        ingress[existingIndex] = next;
      } else {
        const fallbackIndex = findFallbackIngressIndex(ingress);
        if (fallbackIndex >= 0) {
          ingress.splice(fallbackIndex, 0, rule);
        } else {
          ingress.push(rule);
        }
      }

      config.ingress = ensureFallbackIngress(ingress);
      await ctx.service.updateTunnelConfig(ctx.accountId, tunnelId, config);

      try {
        const dns = await ctx.service.upsertTunnelCnameRecord(zone.thirdid, hostname, tunnelId);
        await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '配置 Tunnel 公网主机名', `${hostname} -> ${serviceValue} [${dns?.action ?? '-'}]`);
      } catch (e: any) {
        await ctx.service.updateTunnelConfig(ctx.accountId, tunnelId, oldConfig);
        throw new EnhanceError('Public Hostname 已回滚：' + (e?.message || ''), 400);
      }
      return { code: 0, msg: '配置 Public Hostname 成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/public-hostnames', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const hostname = String(req.query.hostname ?? '').trim();
      const path = String(req.query.path ?? '').trim();
      if (!tunnelId || !hostname) throw new EnhanceError('缺少 tunnel_id 或 hostname');

      const config = extractTunnelConfigObject(await ctx.service.getTunnelConfig(ctx.accountId, tunnelId));
      const oldConfig = JSON.parse(JSON.stringify(config));
      const ingress = Array.isArray(config?.ingress) ? [...config.ingress] : [];
      const nextIngress = ingress.filter(
        (row: any) =>
          !(row && typeof row === 'object' && normalizeHostname(row.hostname) === normalizeHostname(hostname) && String(row.path ?? '').trim() === path),
      );

      config.ingress = ensureFallbackIngress(nextIngress);
      await ctx.service.updateTunnelConfig(ctx.accountId, tunnelId, config);

      const zone = await findBestMatchingDomain(Number(ctx.account.id), hostname);
      if (zone?.thirdid) {
        try {
          await ctx.service.deleteTunnelCnameRecordIfMatch(zone.thirdid, hostname, tunnelId);
        } catch (e: any) {
          await ctx.service.updateTunnelConfig(ctx.accountId, tunnelId, oldConfig);
          throw new EnhanceError('删除 Public Hostname 时已回滚：' + (e?.message || ''), 400);
        }
      }

      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '删除 Tunnel 公网主机名', hostname + (path ? ` [${path}]` : ''));
      return { code: 0, msg: '删除 Public Hostname 成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.get('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/cidr-routes', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      if (!tunnelId) throw new EnhanceError('缺少 tunnel_id');
      const rows: any[] = [];
      for (const row of await ctx.service.listCidrRoutes(ctx.accountId, tunnelId)) {
        const mapped = formatCidrRouteRow(row);
        if (mapped.id && mapped.network) rows.push(mapped);
      }
      return { code: 0, data: rows };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/cidr-routes', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const b = req.body || {};
      const network = String(b.network ?? '').trim();
      const comment = String(b.comment ?? '').trim();
      if (!tunnelId || !network) throw new EnhanceError('Tunnel 和 CIDR 不能为空');
      if (!isValidCidr(network)) throw new EnhanceError('CIDR 格式不正确');

      const route = await ctx.service.createCidrRoute(ctx.accountId, tunnelId, network, comment || null);
      const mapped = formatCidrRouteRow(route);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '创建 Tunnel CIDR 路由', mapped.network);
      return { code: 0, msg: '创建 CIDR 路由成功', data: mapped };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/cidr-routes/:routeId', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const routeId = String(req.params.routeId ?? '').trim();
      if (!tunnelId || !routeId) throw new EnhanceError('缺少 tunnel_id 或 route_id');

      const matched = (await ctx.service.listCidrRoutes(ctx.accountId, tunnelId)).some((row: any) => String(row?.id ?? '').trim() === routeId);
      if (!matched) throw new EnhanceError('CIDR 路由不存在或不属于当前 Tunnel');

      await ctx.service.deleteCidrRoute(ctx.accountId, routeId);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '删除 Tunnel CIDR 路由', routeId);
      return { code: 0, msg: '删除 CIDR 路由成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.get('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/hostname-routes', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      if (!tunnelId) throw new EnhanceError('缺少 tunnel_id');
      const rows: any[] = [];
      for (const row of await ctx.service.listHostnameRoutes(ctx.accountId, tunnelId)) {
        const mapped = formatHostnameRouteRow(row);
        if (mapped.id && mapped.hostname) rows.push(mapped);
      }
      return { code: 0, data: rows };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.post('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/hostname-routes', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const b = req.body || {};
      const hostname = String(b.hostname ?? '').trim();
      const comment = String(b.comment ?? '').trim();
      if (!tunnelId || !hostname) throw new EnhanceError('Tunnel 和主机名不能为空');
      if (!checkDomainFormat(hostname)) throw new EnhanceError('主机名格式不正确');

      const route = await ctx.service.createHostnameRoute(ctx.accountId, tunnelId, hostname, comment || null);
      const mapped = formatHostnameRouteRow(route);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '创建 Tunnel 主机名路由', mapped.hostname);
      return { code: 0, msg: '创建主机名路由成功', data: mapped };
    } catch (e: any) {
      return unwrap(e);
    }
  });

  app.delete('/api/cloudflare/accounts/:accountId/tunnels/:tunnelId/hostname-routes/:routeId', auth, async (req: any) => {
    try {
      admin(req);
      const ctx = await getCloudflareAccountContext(Number(req.params.accountId), true, true);
      const tunnelId = String(req.params.tunnelId ?? '').trim();
      const routeId = String(req.params.routeId ?? '').trim();
      if (!tunnelId || !routeId) throw new EnhanceError('缺少 tunnel_id 或 route_id');

      const routes = await ctx.service.listHostnameRoutes(ctx.accountId, tunnelId);
      const matched = routes.some((row: any) => String(row?.id ?? row?.hostname_route_id ?? '').trim() === routeId);
      if (!matched) throw new EnhanceError('主机名路由不存在或不属于当前 Tunnel');

      await ctx.service.deleteHostnameRoute(ctx.accountId, routeId);
      await addLog(req.user.uid, formatAccountDisplayName(ctx.account), '删除 Tunnel 主机名路由', routeId);
      return { code: 0, msg: '删除主机名路由成功' };
    } catch (e: any) {
      return unwrap(e);
    }
  });
}
