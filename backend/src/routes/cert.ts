import type { FastifyInstance } from 'fastify';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, table } from '../db.js';
import { certConfig, certClassConfig } from '../lib/cert/factory.js';
import { getCertProvider } from '../lib/cert/factory.js';
import { getMainDomain } from '../lib/cert/utils.js';
import { CertOrderService, buildPfx, STATUS_LABEL } from '../lib/certService.js';
import { deployConfig, deployClassConfig, isDeployImplemented, getDeployProvider } from '../lib/deploy/factory.js';
import { CertDeployService } from '../lib/deployService.js';
import { certOrderSend, certDeploySend } from '../lib/monitor/msgNotice.js';
import { configGet, configSet } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'runtime', 'log');

function safeJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseCertKey(fullchain: string, privatekey: string) {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(fullchain);
  } catch {
    return { code: -1, msg: '证书内容填写错误' };
  }
  let key;
  try {
    key = createPrivateKey(privatekey);
  } catch {
    return { code: -1, msg: '私钥内容填写错误' };
  }
  try {
    if (!cert.checkPrivateKey(key)) return { code: -1, msg: 'SSL证书与私钥不匹配' };
  } catch {
    return { code: -1, msg: 'SSL证书与私钥不匹配' };
  }
  const san = cert.subjectAltName || '';
  if (!san) return { code: -1, msg: '证书内容解析失败' };

  const pub = cert.publicKey;
  let keytype = 'Unknown';
  let keysize = 0;
  if (pub.asymmetricKeyType === 'rsa') {
    keytype = 'RSA';
    keysize = pub.asymmetricKeyDetails?.modulusLength || 0;
  } else if (pub.asymmetricKeyType === 'ec') {
    keytype = 'ECC';
    const curve = (pub as any).asymmetricKeyDetails?.namedCurve || '';
    keysize = curve.includes('384') ? 384 : curve.includes('521') ? 521 : 256;
  }

  const domains: string[] = [];
  for (const line of san.split(',')) {
    let d = line.trim();
    if (d.startsWith('DNS:')) d = d.slice(4).trim();
    if (d && !domains.includes(d)) domains.push(d);
  }
  if (!domains.length) return { code: -1, msg: '证书绑定域名不能为空' };

  const issuer = cert.issuer.match(/CN\s*=\s*([^,]+)/i)?.[1]?.trim() || '';
  return {
    code: 0,
    keytype,
    keysize,
    issuetime: new Date(cert.validFrom).toISOString().slice(0, 19).replace('T', ' '),
    expiretime: new Date(cert.validTo).toISOString().slice(0, 19).replace('T', ' '),
    issuer,
    domains,
  };
}

async function checkOrder(order: any, domains: string[]) {
  const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ?`, [order.aid]);
  if (!account) return { code: -1, msg: 'SSL证书账户不存在' };
  const meta = certConfig[account.type];
  if (!meta) return { code: -1, msg: 'SSL证书账户类型不存在' };
  const maxDomains = meta.max_domains;
  const wildcard = meta.wildcard;
  const cname = meta.cname;

  if (domains.length > maxDomains) {
    const ok = domains.length === 2 && maxDomains === 1 && domains[0].replace(/^www\./, '') === domains[1].replace(/^www\./, '');
    if (!ok) return { code: -1, msg: '域名数量不能超过' + maxDomains + '个' };
  }

  for (let domain of domains) {
    if (!wildcard && domain.includes('*')) return { code: -1, msg: '该证书账户类型不支持泛域名' };
    const mainDomain = await getMainDomain(domain);
    let drow = await queryOne(`SELECT name FROM ${table('domain')} WHERE name = ?`, [mainDomain]);
    if (!drow) {
      drow = await queryOne(`SELECT B.name FROM ${table('domain_alias')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.name = ?`, [mainDomain]);
      if (!drow) {
        if (domain.startsWith('*.')) domain = domain.slice(2);
        const cnameRow = !cname ? null : await queryOne(`SELECT id FROM ${table('cert_cname')} WHERE domain = ? AND status = 1`, [domain]);
        if (!cnameRow) return { code: -1, msg: '域名' + domain + '未在本系统添加' };
      }
    }
  }
  return true;
}

export default async function certRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).authenticate };

  // ============ 元数据 ============
  app.get('/api/cert/providers', auth, async () => {
    return { code: 0, data: certConfig, class_config: certClassConfig };
  });

  // ============ 证书账户 ============
  app.get('/api/cert/accounts', auth, async (req: any) => {
    const { kw, offset = 0, limit = 20, deploy = 0 } = req.query || {};
    const isDeploy = Number(deploy) === 1;
    let where = isDeploy ? 'deploy = 1' : 'deploy = 0';
    const params: any[] = [];
    if (kw) {
      where += ' AND (name LIKE ? OR remark LIKE ? OR id = ?)';
      params.push('%' + kw + '%', '%' + kw + '%', kw);
    }
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_account')} WHERE ${where}`, params))?.c || 0;
    const rows = await query(`SELECT * FROM ${table('cert_account')} WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, Number(limit), Number(offset)]);
    const list = rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      config: r.config,
      remark: r.remark,
      addtime: r.addtime,
      typename: isDeploy ? (deployConfig[r.type]?.name || '') : (certConfig[r.type]?.name || ''),
      icon: isDeploy ? (deployConfig[r.type]?.icon || '') : (certConfig[r.type]?.icon || ''),
    }));
    return { code: 0, total, data: list };
  });

  app.post('/api/cert/accounts', auth, async (req: any) => {
    const { type, name, config, remark, deploy = 0 } = req.body || {};
    if (!name || !config) return { code: -1, msg: '必填参数不能为空' };
    const cfgStr = JSON.stringify(config);
    const isDeploy = Number(deploy) === 1;
    const dup = await queryOne(`SELECT id FROM ${table('cert_account')} WHERE type = ? AND config = ? AND deploy = ?`, [type, cfgStr, deploy]);
    if (dup) return { code: -1, msg: isDeploy ? '自动部署账户已存在' : 'SSL证书账户已存在' };

    if (isDeploy) {
      const provider = getDeployProvider(type, config);
      if (!provider) return { code: -1, msg: '该部署类型暂未支持' };
      try {
        await provider.check();
      } catch (e: any) {
        return { code: -1, msg: '验证自动部署账户失败，' + e.message };
      }
      await query(`INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES (?, ?, ?, ?, 1, NOW())`, [type, name, cfgStr, remark || '']);
      return { code: 0, msg: '添加自动部署账户成功！' };
    }

    const provider = getCertProvider(type, config, null);
    if (!provider) return { code: -1, msg: '证书类型不存在' };
    try {
      const ext = await provider.register();
      const id = await query(`INSERT INTO ${table('cert_account')} (type, name, config, remark, deploy, addtime) VALUES (?, ?, ?, ?, 0, NOW())`, [type, name, cfgStr, remark || '']).then((r: any) => r.insertId || 0);
      if (ext && typeof ext === 'object') {
        await query(`UPDATE ${table('cert_account')} SET ext = ? WHERE id = ?`, [JSON.stringify(ext), id]);
      }
      return { code: 0, msg: '添加SSL证书账户成功！' };
    } catch (e: any) {
      return { code: -1, msg: '验证SSL证书账户失败，' + e.message };
    }
  });

  app.put('/api/cert/accounts/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const { type, name, config, remark, deploy = 0 } = req.body || {};
    if (!name || !config) return { code: -1, msg: '必填参数不能为空' };
    const cfgStr = JSON.stringify(config);
    const isDeploy = Number(deploy) === 1;
    const dup = await queryOne(`SELECT id FROM ${table('cert_account')} WHERE type = ? AND config = ? AND deploy = ? AND id <> ?`, [type, cfgStr, deploy, id]);
    if (dup) return { code: -1, msg: isDeploy ? '自动部署账户已存在' : 'SSL证书账户已存在' };

    if (isDeploy) {
      const provider = getDeployProvider(type, config);
      if (!provider) return { code: -1, msg: '该部署类型暂未支持' };
      try {
        await provider.check();
      } catch (e: any) {
        return { code: -1, msg: '验证自动部署账户失败，' + e.message };
      }
      await query(`UPDATE ${table('cert_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [type, name, cfgStr, remark || '', id]);
      return { code: 0, msg: '修改自动部署账户成功！' };
    }

    const provider = getCertProvider(type, config, null);
    if (!provider) return { code: -1, msg: '证书类型不存在' };
    try {
      const ext = await provider.register();
      await query(`UPDATE ${table('cert_account')} SET type = ?, name = ?, config = ?, remark = ? WHERE id = ?`, [type, name, cfgStr, remark || '', id]);
      if (ext && typeof ext === 'object') {
        await query(`UPDATE ${table('cert_account')} SET ext = ? WHERE id = ?`, [JSON.stringify(ext), id]);
      }
      return { code: 0, msg: '修改SSL证书账户成功！' };
    } catch (e: any) {
      return { code: -1, msg: '验证SSL证书账户失败，' + e.message };
    }
  });

  app.delete('/api/cert/accounts/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const { deploy = 0 } = req.query || {};
    const isDeploy = Number(deploy) === 1;
    if (isDeploy) {
      const count = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} WHERE aid = ?`, [id]))?.c || 0;
      if (count > 0) return { code: -1, msg: '该账户下存在自动部署任务，无法删除' };
    } else {
      const count = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_order')} WHERE aid = ?`, [id]))?.c || 0;
      if (count > 0) return { code: -1, msg: '该账户下存在证书订单，无法删除' };
    }
    await query(`DELETE FROM ${table('cert_account')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // ============ 证书订单 ============
  app.get('/api/cert/orders', auth, async (req: any) => {
    const { domain, id, aid, type, status, offset = 0, limit = 20 } = req.query || {};
    let where = '1=1';
    const params: any[] = [];
    if (id) {
      where += ' AND A.id = ?';
      params.push(id);
    } else if (domain) {
      const oids = await query(`SELECT oid FROM ${table('cert_domain')} WHERE domain LIKE ?`, ['%' + domain + '%']);
      where += ' AND A.id IN (' + (oids.map((o: any) => o.oid).join(',') || '0') + ')';
    }
    if (aid) {
      where += ' AND A.aid = ?';
      params.push(aid);
    }
    if (type) {
      where += ' AND B.type = ?';
      params.push(type);
    }
    if (status !== undefined && status !== '') {
      if (status === '5') where += ' AND A.status < 0';
      else if (status === '6') where += ' AND A.expiretime < ? AND A.expiretime >= NOW()';
      else if (status === '7') where += ' AND A.expiretime < NOW()';
      else {
        where += ' AND A.status = ?';
        params.push(status);
      }
    }
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_order')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id WHERE ${where}`, params))?.c || 0;
    const rows = await query(
      `SELECT A.*, B.type, B.remark AS aremark FROM ${table('cert_order')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id WHERE ${where} ORDER BY A.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    const list = [];
    for (const r of rows) {
      const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [r.id]);
      list.push({
        id: r.id,
        aid: r.aid,
        type: r.type,
        typename: r.type ? certConfig[r.type]?.name || '' : null,
        keytype: r.keytype,
        keysize: r.keysize,
        domains: domains.map((d: any) => d.domain),
        status: r.status,
        error: r.error,
        isauto: r.isauto,
        issuetime: r.issuetime,
        expiretime: r.expiretime,
        issuer: r.issuer,
        addtime: r.addtime,
        updatetime: r.updatetime,
        end_day: r.expiretime ? Math.ceil((new Date(r.expiretime).getTime() - Date.now()) / 86400000) : null,
      });
    }
    return { code: 0, total, data: list, status_label: STATUS_LABEL };
  });

  app.post('/api/cert/orders', auth, async (req: any) => {
    const { aid, keytype, keysize, fullchain, privatekey, domains } = req.body || {};
    let order: any;
    let domList: string[] = [];

    if (aid == -1) {
      const certInfo = parseCertKey(fullchain, privatekey);
      if (certInfo.code === -1) return certInfo;
      domList = certInfo.domains;
      const dupIds = await query(`SELECT id FROM ${table('cert_order')} WHERE issuetime = ?`, [certInfo.issuetime]);
      for (const d of dupIds) {
        const d2 = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ?`, [d.id]);
        const list2 = d2.map((x: any) => x.domain).sort();
        if (JSON.stringify(list2) === JSON.stringify([...domList].sort())) {
          return { code: -1, msg: '该证书已存在，无需重复添加' };
        }
      }
      order = {
        aid: 0,
        keytype: certInfo.keytype,
        keysize: certInfo.keysize,
        addtime: new Date(),
        updatetime: new Date(),
        issuetime: certInfo.issuetime,
        expiretime: certInfo.expiretime,
        issuer: certInfo.issuer,
        status: 3,
        isauto: 1,
        fullchain,
        privatekey,
      };
    } else {
      order = { aid, keytype, keysize, addtime: new Date(), issuer: '', status: 0, isauto: 1 };
      domList = (domains || []).map((d: string) => d.trim()).filter(Boolean);
      domList = [...new Set(domList)];
      if (!domList.length) return { code: -1, msg: '绑定域名不能为空' };
      const res = await checkOrder(order, domList);
      if (typeof res === 'object') return res;
    }
    if (!order.keytype || !order.keysize) return { code: -1, msg: '必填参数不能为空' };

    const id = await query(`INSERT INTO ${table('cert_order')} SET ?`, [order]).then((r: any) => r.insertId || 0);
    let i = 1;
    for (const domain of domList) {
      await query(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES (?, ?, ?)`, [id, domainToASCII(domain), i++]);
    }
    return { code: 0, msg: '添加证书订单成功！', data: id };
  });

  app.put('/api/cert/orders/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const { aid, keytype, keysize, fullchain, privatekey, domains } = req.body || {};
    const row = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '证书订单不存在' };
    let order: any;
    let domList: string[] = [];

    if (aid == -1) {
      const certInfo = parseCertKey(fullchain, privatekey);
      if (certInfo.code === -1) return certInfo;
      domList = certInfo.domains;
      order = {
        aid: 0,
        keytype: certInfo.keytype,
        keysize: certInfo.keysize,
        updatetime: new Date(),
        issuetime: certInfo.issuetime,
        expiretime: certInfo.expiretime,
        issuer: certInfo.issuer,
        status: 3,
        issend: 0,
        fullchain,
        privatekey,
      };
    } else {
      domList = (domains || []).map((d: string) => d.trim()).filter(Boolean);
      domList = [...new Set(domList)];
      if (!domList.length) return { code: -1, msg: '绑定域名不能为空' };
      order = { aid, keytype, keysize, updatetime: new Date() };
      const res = await checkOrder(order, domList);
      if (typeof res === 'object') return res;
    }

    await query(`UPDATE ${table('cert_order')} SET ? WHERE id = ?`, [order, id]);
    await query(`DELETE FROM ${table('cert_domain')} WHERE oid = ?`, [id]);
    let i = 1;
    for (const domain of domList) {
      await query(`INSERT INTO ${table('cert_domain')} (oid, domain, sort) VALUES (?, ?, ?)`, [id, domainToASCII(domain), i++]);
    }
    return { code: 0, msg: '修改证书订单成功！' };
  });

  app.delete('/api/cert/orders/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const count = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} WHERE oid = ?`, [id]))?.c || 0;
    if (count > 0) return { code: -1, msg: '该证书关联了自动部署任务，无法删除' };
    try {
      await new CertOrderService(id).cancel();
    } catch {
      // ignore
    }
    await query(`DELETE FROM ${table('cert_order')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('cert_domain')} WHERE oid = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/cert/orders/:id/process', auth, async (req: any) => {
    const { id } = req.params as any;
    const { reset = 0 } = req.body || {};
    try {
      const service = new CertOrderService(id);
      if (reset == 1) await service.reset();
      const code = await service.process(true);
      if (code === 3) {
        certOrderSend(Number(id), true).catch(() => {});
        return { code: 0, msg: '证书已签发成功！' };
      }
      if (code === 1) return { code: 0, msg: '添加DNS记录成功！请等待DNS生效后点击验证' };
      return { code: 0, msg: '证书处理完成' };
    } catch (e: any) {
      certOrderSend(Number(id), false).catch(() => {});
      return { code: -1, msg: e.message };
    }
  });

  app.post('/api/cert/orders/:id/reset', auth, async (req: any) => {
    const { id } = req.params as any;
    try {
      const service = new CertOrderService(id);
      await service.cancel();
      await service.reset();
      return { code: 0, msg: '重置成功' };
    } catch (e: any) {
      return { code: -1, msg: e.message };
    }
  });

  app.post('/api/cert/orders/:id/revoke', auth, async (req: any) => {
    const { id } = req.params as any;
    try {
      await new CertOrderService(id).revoke();
      return { code: 0, msg: '吊销成功' };
    } catch (e: any) {
      return { code: -1, msg: e.message };
    }
  });

  app.post('/api/cert/orders/:id/setauto', auth, async (req: any) => {
    const { id } = req.params as any;
    const { isauto } = req.body || {};
    await query(`UPDATE ${table('cert_order')} SET isauto = ? WHERE id = ?`, [isauto ? 1 : 0, id]);
    return { code: 0, msg: '操作成功' };
  });

  app.get('/api/cert/orders/:id/info', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '证书订单不存在' };
    const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [id]);
    let pfx = null;
    if (row.fullchain && row.privatekey) {
      try {
        pfx = (await buildPfx(row.fullchain, row.privatekey)).toString('base64');
      } catch {
        pfx = null;
      }
    }
    return {
      code: 0,
      data: {
        id: row.id,
        crt: row.fullchain,
        key: row.privatekey,
        pfx,
        issuetime: row.issuetime,
        expiretime: row.expiretime,
        domains: domains.map((d: any) => d.domain),
      },
    };
  });

  app.get('/api/cert/orders/:id/log', auth, async (req: any) => {
    const { id } = req.params as any;
    const row = await queryOne(`SELECT processid FROM ${table('cert_order')} WHERE id = ?`, [id]);
    if (!row?.processid) return { code: -1, msg: '无日志' };
    const file = join(LOG_DIR, row.processid + '.log');
    if (!existsSync(file)) return { code: -1, msg: '日志文件不存在' };
    return { code: 0, data: readFileSync(file, 'utf8') };
  });

  // ============ CNAME 代理 ============
  app.get('/api/cert/cnames', auth, async () => {
    const rows = await query(`SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A LEFT JOIN ${table('domain')} B ON A.did = B.id ORDER BY A.id DESC`);
    return { code: 0, data: rows };
  });

  app.post('/api/cert/cnames', auth, async (req: any) => {
    const { domain, did, rr } = req.body || {};
    if (!domain || !did || !rr) return { code: -1, msg: '必填参数不能为空' };
    await query(`INSERT INTO ${table('cert_cname')} (domain, did, rr, addtime, status) VALUES (?, ?, ?, NOW(), 1)`, [domain, did, rr]);
    return { code: 0, msg: '添加成功' };
  });

  app.delete('/api/cert/cnames/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    await query(`DELETE FROM ${table('cert_cname')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // ============ 自动部署 ============
  app.get('/api/deploy/providers', auth, async () => {
    const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(deployConfig)) {
      data[k] = { ...v, implemented: isDeployImplemented(k) };
    }
    return { code: 0, data, class_config: deployClassConfig };
  });

  app.get('/api/deploy/tasks', auth, async (req: any) => {
    const { offset = 0, limit = 20, status, oid } = req.query || {};
    let where = '1=1';
    const params: any[] = [];
    if (status !== undefined && status !== '') {
      where += ' AND A.status = ?';
      params.push(status);
    }
    if (oid) {
      where += ' AND A.oid = ?';
      params.push(oid);
    }
    const total = (await queryOne(`SELECT COUNT(*) AS c FROM ${table('cert_deploy')} A WHERE ${where}`, params))?.c || 0;
    const rows = await query(
      `SELECT A.*, B.type, B.name AS aname, C.aid AS certaid FROM ${table('cert_deploy')} A LEFT JOIN ${table('cert_account')} B ON A.aid = B.id LEFT JOIN ${table('cert_order')} C ON A.oid = C.id WHERE ${where} ORDER BY A.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    const list = [];
    for (const r of rows) {
      const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [r.oid]);
      list.push({
        id: r.id,
        aid: r.aid,
        oid: r.oid,
        type: r.type,
        typename: r.type ? deployConfig[r.type]?.name || '' : '',
        aname: r.aname,
        remark: r.remark,
        status: r.status,
        active: r.active,
        error: r.error,
        lasttime: r.lasttime,
        addtime: r.addtime,
        domains: domains.map((d: any) => d.domain),
      });
    }
    return { code: 0, total, data: list };
  });

  app.post('/api/deploy/tasks', auth, async (req: any) => {
    const { aid, oid, config, remark } = req.body || {};
    if (!aid || !oid || !config) return { code: -1, msg: '必填参数不能为空' };
    await query(
      `INSERT INTO ${table('cert_deploy')} (aid, oid, config, remark, addtime, status, active) VALUES (?, ?, ?, ?, NOW(), 0, 1)`,
      [aid, oid, JSON.stringify(config), remark || ''],
    );
    return { code: 0, msg: '添加自动部署任务成功！' };
  });

  app.put('/api/deploy/tasks/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    const { aid, oid, config, remark } = req.body || {};
    if (!aid || !oid || !config) return { code: -1, msg: '必填参数不能为空' };
    await query(`UPDATE ${table('cert_deploy')} SET aid = ?, oid = ?, config = ?, remark = ? WHERE id = ?`, [aid, oid, JSON.stringify(config), remark || '', id]);
    return { code: 0, msg: '修改自动部署任务成功！' };
  });

  app.delete('/api/deploy/tasks/:id', auth, async (req: any) => {
    const { id } = req.params as any;
    await query(`DELETE FROM ${table('cert_deploy')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/deploy/tasks/:id/process', auth, async (req: any) => {
    const { id } = req.params as any;
    try {
      await new CertDeployService(id).process(true);
      certDeploySend(Number(id), true).catch(() => {});
      return { code: 0, msg: 'SSL证书部署任务执行成功！' };
    } catch (e: any) {
      certDeploySend(Number(id), false).catch(() => {});
      return { code: -1, msg: e.message };
    }
  });

  app.post('/api/deploy/tasks/:id/reset', auth, async (req: any) => {
    const { id } = req.params as any;
    try {
      await new CertDeployService(id).reset();
      return { code: 0, msg: '重置成功' };
    } catch (e: any) {
      return { code: -1, msg: e.message };
    }
  });

  app.post('/api/deploy/tasks/:id/setactive', auth, async (req: any) => {
    const { id } = req.params as any;
    const { active } = req.body || {};
    await query(`UPDATE ${table('cert_deploy')} SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
    return { code: 0, msg: '操作成功' };
  });

  const SETTINGS_KEYS = ['cert_renewdays', 'deploy_hour_start', 'deploy_hour_end', 'cert_notice_mail', 'cert_notice_wxtpl', 'cert_notice_tgbot', 'cert_notice_webhook', 'cert_notice_custom_webhook'];

  app.get('/api/cert/settings', auth, async () => {
    const data: Record<string, string | null> = {};
    for (const k of SETTINGS_KEYS) data[k] = await configGet(k, '');
    return { code: 0, data };
  });

  app.post('/api/cert/settings', auth, async (req: any) => {
    const body = req.body || {};
    for (const k of SETTINGS_KEYS) {
      if (k in body) await configSet(k, String(body[k] ?? ''));
    }
    return { code: 0, msg: '设置保存成功' };
  });
}