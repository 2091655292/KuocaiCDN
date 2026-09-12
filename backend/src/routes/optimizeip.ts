import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { configGet, configSet } from '../config.js';
import { fmtDateTime } from '../lib/util.js';
import { getLicense, executeOne } from '../lib/optimize/optimizeService.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

export default async function optimizeRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 域名列表（排除 cloudflare，用于添加任务）
  app.get('/api/optimize/domains', auth, async () => {
    const rows = await query(
      `SELECT A.id, A.name FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE B.type <> 'cloudflare' ORDER BY A.id DESC`
    );
    return { code: 0, data: rows };
  });

  // 设置
  app.get('/api/optimize/settings', auth, async () => {
    return {
      code: 0,
      data: {
        optimize_ip_api: (await configGet('optimize_ip_api', '0')) || '0',
        optimize_ip_key: (await configGet('optimize_ip_key', 'o1zrmHAF')) || 'o1zrmHAF',
        optimize_ip_proxy: (await configGet('optimize_ip_proxy', '')) || '',
        optimize_ip_min: (await configGet('optimize_ip_min', '30')) || '30',
      },
    };
  });

  app.post('/api/optimize/settings', auth, async (req: any) => {
    const b = req.body || {};
    for (const [key, value] of Object.entries(b)) {
      if (!key) continue;
      if (key === 'optimize_ip_min' && parseInt(String(value)) < 10) {
        return { code: -1, msg: '自动更新时间间隔不能小于10分钟' };
      }
      await configSet(key, String(value));
    }
    return { code: 0, msg: 'succ' };
  });

  // 查询积分
  app.post('/api/optimize/queryapi', auth, async (req: any) => {
    const api = Number((req.body || {}).optimize_ip_api);
    const key = ((req.body || {}).optimize_ip_key || '').trim();
    if (!key) return { code: -1, msg: '参数不能为空' };
    try {
      const result = await getLicense(api, key);
      return { code: 0, msg: '当前积分余额：' + result };
    } catch (e: any) {
      return { code: -1, msg: e.message };
    }
  });

  // 任务列表
  app.get('/api/optimize/tasks', auth, async (req: any) => {
    const q = req.query || {};
    const kw = q.kw || '';
    const status = q.status;
    const searchType = Number(q.type || 1);
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let where = '';
    const params: any[] = [];
    if (kw) {
      if (searchType === 1) {
        where += ' AND (A.rr LIKE ? OR B.name LIKE ?)';
        params.push('%' + kw + '%', '%' + kw + '%');
      } else if (searchType === 2) {
        where += ' AND A.remark LIKE ?';
        params.push('%' + kw + '%');
      }
    }
    if (!isNullOrEmpty(status)) {
      where += ' AND A.status = ?';
      params.push(Number(status));
    }

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('optimizeip')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where}`,
      params
    );
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = {
      id: 'A.id', rr: 'A.rr', cdn_type: 'A.cdn_type', recordnum: 'A.recordnum', ip_type: 'A.ip_type',
      active: 'A.active', updatetime: 'A.updatetime', status: 'A.status',
    };
    const orderBy = allowedSort[sort] ? `${allowedSort[sort]} ${orderDir}` : 'A.id DESC';

    const list = await query(
      `SELECT A.*, B.name AS domain FROM ${table('optimizeip')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { code: 0, data: { total, list } };
  });

  // 任务详情
  app.get('/api/optimize/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(`SELECT * FROM ${table('optimizeip')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '任务不存在' };
    return { code: 0, data: task };
  });

  // 添加任务
  app.post('/api/optimize/tasks', auth, async (req: any) => {
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      type: Number(b.type),
      ip_type: (b.ip_type || '').trim(),
      cdn_type: Number(b.cdn_type),
      recordnum: Number(b.recordnum),
      ttl: Number(b.ttl),
      remark: (b.remark || '').trim(),
      addtime: fmtDateTime(),
      active: 1,
    };
    if (!task.did || !task.rr || !task.ip_type || !task.recordnum || !task.ttl) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (task.recordnum < 1) return { code: -1, msg: '解析数量不能少于1个' };
    if (task.recordnum > 50) return { code: -1, msg: '解析数量不能超过50个' };
    const exists = await queryOne(`SELECT id FROM ${table('optimizeip')} WHERE did = ? AND rr = ?`, [task.did, task.rr]);
    if (exists) return { code: -1, msg: '当前域名的优选IP任务已存在' };

    await query(
      `INSERT INTO ${table('optimizeip')} (did, rr, type, ip_type, cdn_type, recordnum, ttl, remark, addtime, active) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [task.did, task.rr, task.type, task.ip_type, task.cdn_type, task.recordnum, task.ttl, task.remark, task.addtime, task.active]
    );
    return { code: 0, msg: '添加成功' };
  });

  // 编辑任务
  app.put('/api/optimize/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      type: Number(b.type),
      ip_type: (b.ip_type || '').trim(),
      cdn_type: Number(b.cdn_type),
      recordnum: Number(b.recordnum),
      ttl: Number(b.ttl),
      remark: (b.remark || '').trim(),
    };
    if (!task.did || !task.rr || !task.ip_type || !task.recordnum || !task.ttl) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (task.recordnum < 1) return { code: -1, msg: '解析数量不能少于1个' };
    if (task.recordnum > 50) return { code: -1, msg: '解析数量不能超过50个' };
    const exists = await queryOne(`SELECT id FROM ${table('optimizeip')} WHERE did = ? AND rr = ? AND id <> ?`, [task.did, task.rr, id]);
    if (exists) return { code: -1, msg: '当前域名的优选IP任务已存在' };

    await query(
      `UPDATE ${table('optimizeip')} SET did=?, rr=?, type=?, ip_type=?, cdn_type=?, recordnum=?, ttl=?, remark=? WHERE id=?`,
      [task.did, task.rr, task.type, task.ip_type, task.cdn_type, task.recordnum, task.ttl, task.remark, id]
    );
    return { code: 0, msg: '修改成功' };
  });

  // 启停
  app.post('/api/optimize/tasks/:id/active', auth, async (req: any) => {
    const id = Number(req.params.id);
    const active = Number((req.body || {}).active);
    await query(`UPDATE ${table('optimizeip')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: '设置成功' };
  });

  // 删除
  app.delete('/api/optimize/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM ${table('optimizeip')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  // 立即执行
  app.post('/api/optimize/tasks/:id/run', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(`SELECT * FROM ${table('optimizeip')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '任务不存在' };
    try {
      const result = await executeOne(task);
      await query(`UPDATE ${table('optimizeip')} SET status = 1, errmsg = NULL, updatetime = ? WHERE id = ?`, [fmtDateTime(), id]);
      return { code: 0, msg: '优选任务执行成功：' + result };
    } catch (e: any) {
      await query(`UPDATE ${table('optimizeip')} SET status = 2, errmsg = ?, updatetime = ? WHERE id = ?`, [e.message || String(e), fmtDateTime(), id]);
      return { code: -1, msg: '优选任务执行失败：' + e.message };
    }
  });

  // 运行状态
  app.get('/api/optimize/status', auth, async () => {
    const runTime = await queryOne<{ updatetime: string }>(
      `SELECT updatetime FROM ${table('optimizeip')} WHERE active = 1 ORDER BY updatetime DESC LIMIT 1`
    );
    let runState = 0;
    if (runTime && runTime.updatetime) {
      const t = new Date(runTime.updatetime.replace(/-/g, '/')).getTime();
      runState = Date.now() - t > 3600 * 1000 ? 0 : 1;
    }
    return { code: 0, data: runState === 1 ? 'ok' : 'error' };
  });
}