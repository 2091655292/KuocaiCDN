import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { getDnsProvider, dnsProviders } from '../lib/dns/factory.js';
import { getCdnProvider, cdnConfig } from '../lib/cdn/factory.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isAdmin(user: any): boolean {
  return checkLevel(user, 2);
}

export default async function accountRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // ============ DNS 账户 ============
  app.get('/api/dns/providers', auth, async () => {
    return { code: 0, data: dnsProviders };
  });

  app.get('/api/dns/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT id, type, name, config, remark, addtime FROM ${table('account')} ORDER BY id DESC`);
    return { code: 0, data: rows };
  });

  app.post('/api/dns/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('account')} WHERE type = ? AND name = ?`, [type, name]);
    if (exists) return { code: -1, msg: '账户已存在' };
    const provider = getDnsProvider(type, config, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    const id = await insertAndGetId(`INSERT INTO ${table('account')} (type, name, config, remark, addtime) VALUES (?, ?, ?, ?, NOW())`, [
      type, name, JSON.stringify(config), remark || '',
    ]);
    return { code: 0, msg: '添加账户成功', data: id };
  });

  app.put('/api/dns/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const provider = getDnsProvider(type, config, '', null);
    if (!provider) return { code: -1, msg: '该厂商暂未支持' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证账户失败，' + provider.getError() };
    await query(`UPDATE ${table('account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, JSON.stringify(config), remark || '', id,
    ]);
    return { code: 0, msg: '修改账户成功' };
  });

  app.delete('/api/dns/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('domain')} WHERE aid = ?`, [id]);
    if (dcount && dcount.c > 0) return { code: -1, msg: '该账户下存在域名，无法删除' };
    await query(`DELETE FROM ${table('account')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // ============ CDN 账户 ============
  app.get('/api/cdn/providers', auth, async () => {
    return { code: 0, data: cdnConfig };
  });

  app.get('/api/cdn/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const rows = await query(`SELECT id, type, name, config, remark, addtime FROM ${table('cdn_account')} ORDER BY id DESC`);
    const typeNames = Object.fromEntries(Object.entries(cdnConfig).map(([k, v]) => [k, v.name]));
    const data = rows.map((r: any) => ({ ...r, typename: typeNames[r.type] || r.type }));
    return { code: 0, data };
  });

  app.post('/api/cdn/accounts', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const exists = await queryOne(`SELECT id FROM ${table('cdn_account')} WHERE type = ? AND name = ?`, [type, name]);
    if (exists) return { code: -1, msg: 'CDN账户已存在' };
    const provider = getCdnProvider(type, config);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    const id = await insertAndGetId(`INSERT INTO ${table('cdn_account')} (type, name, config, remark, addtime) VALUES (?, ?, ?, ?, NOW())`, [
      type, name, JSON.stringify(config), remark || '',
    ]);
    return { code: 0, msg: '添加CDN账户成功', data: id };
  });

  app.put('/api/cdn/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const { type, name, config, remark } = req.body || {};
    if (!type || !name || !config) return { code: -1, msg: '必填参数不能为空' };
    const provider = getCdnProvider(type, config);
    if (!provider) return { code: -1, msg: 'CDN模块不存在' };
    const ok = await provider.check();
    if (!ok) return { code: -1, msg: '验证CDN账户失败，' + provider.getError() };
    await query(`UPDATE ${table('cdn_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [
      type, name, JSON.stringify(config), remark || '', id,
    ]);
    return { code: 0, msg: '修改CDN账户成功' };
  });

  app.delete('/api/cdn/accounts/:id', auth, async (req: any) => {
    if (!isAdmin(req.user)) return { code: -1, msg: '无权限' };
    const { id } = req.params as any;
    const dcount = await queryOne(`SELECT COUNT(*) c FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
    await query(`DELETE FROM ${table('cdn_domain')} WHERE aid = ?`, [id]);
    await query(`DELETE FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' + (dcount && dcount.c > 0 ? '，已一并删除 ' + dcount.c + ' 个加速域名' : '') };
  });

  app.get('/api/cdn/accounts/:id/zones', auth, async (req: any) => {
    const { id } = req.params as any;
    const acct = await queryOne(`SELECT * FROM ${table('cdn_account')} WHERE id = ?`, [id]);
    if (!acct) return { code: -1, msg: 'CDN账户不存在' };
    const provider = getCdnProvider(acct.type, safeJson(acct.config));
    if (!provider || typeof provider.getZones !== 'function') return { code: -1, msg: '该账户不支持站点查询' };
    const zones = await provider.getZones();
    return { code: 0, data: zones };
  });
}

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

async function insertAndGetId(sql: string, params: any[]): Promise<number> {
  const r = await query(sql, params);
  return (r as any).insertId || 0;
}