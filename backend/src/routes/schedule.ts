import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { fmtTimestamp } from '../lib/util.js';
import { updateNexttime } from '../lib/schedule/scheduleService.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

export default async function scheduleRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/schedule/domains', auth, async () => {
    const rows = await query(
      `SELECT A.id, A.name, B.type FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id ORDER BY A.id DESC`
    );
    return { code: 0, data: rows };
  });

  app.get('/api/schedule/tasks', auth, async (req: any) => {
    const q = req.query || {};
    const kw = q.kw || '';
    const stype = q.stype;
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
        where += ' AND A.recordid = ?';
        params.push(kw);
      } else if (searchType === 3) {
        where += ' AND A.value = ?';
        params.push(kw);
      } else if (searchType === 4) {
        where += ' AND A.remark LIKE ?';
        params.push('%' + kw + '%');
      }
    }
    if (!isNullOrEmpty(stype)) {
      where += ' AND A.type = ?';
      params.push(Number(stype));
    }

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('sctask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where}`,
      params
    );
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = {
      id: 'A.id', rr: 'A.rr', type: 'A.type', switchtype: 'A.switchtype', active: 'A.active',
      updatetimestr: 'A.updatetime', nexttimestr: 'A.nexttime', addtimestr: 'A.addtime', remark: 'A.remark',
    };
    const orderBy = allowedSort[sort] ? `${allowedSort[sort]} ${orderDir}` : 'A.id DESC';

    const list = await query(
      `SELECT A.*, B.name AS domain FROM ${table('sctask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const rows = list.map((r: any) => ({
      ...r,
      addtimestr: fmtTimestamp(r.addtime),
      updatetimestr: r.updatetime > 0 ? fmtTimestamp(r.updatetime) : '未运行',
      nexttimestr: r.nexttime > 0 ? fmtTimestamp(r.nexttime) : '无',
    }));

    return { code: 0, data: { total, list: rows } };
  });

  app.get('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (!task) return { code: -1, msg: '切换策略不存在' };
    return { code: 0, data: task };
  });

  app.post('/api/schedule/tasks', auth, async (req: any) => {
    const b = req.body || {};
    let val = buildTask(b);
    if (!val.did || !val.rr || !val.recordid) return { code: -1, msg: '必填项不能为空' };
    const exists = await queryOne(
      `SELECT id FROM ${table('sctask')} WHERE recordid = ? AND switchtype = ? AND switchtime = ?`,
      [val.recordid, val.switchtype, val.switchtime]
    );
    if (exists) return { code: -1, msg: '当前定时切换策略已存在' };

    await query(
      `INSERT INTO ${table('sctask')} (did, rr, recordid, type, cycle, switchtype, switchdate, switchtime, value, line, remark, recordinfo, addtime, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [val.did, val.rr, val.recordid, val.type, val.cycle, val.switchtype, val.switchdate, val.switchtime, val.value, val.line, val.remark, val.recordinfo, Math.floor(Date.now() / 1000), 1]
    );
    const idRow = await queryOne(`SELECT id FROM ${table('sctask')} WHERE recordid = ? AND switchtype = ? AND switchtime = ? ORDER BY id DESC LIMIT 1`, [val.recordid, val.switchtype, val.switchtime]);
    if (idRow) {
      const row = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [idRow.id]);
      if (row) await updateNexttime(row);
    }
    return { code: 0, msg: '添加成功' };
  });

  app.put('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const val = buildTask(b);
    if (!val.did || !val.rr || !val.recordid) return { code: -1, msg: '必填项不能为空' };
    const exists = await queryOne(
      `SELECT id FROM ${table('sctask')} WHERE recordid = ? AND switchtype = ? AND switchtime = ? AND id <> ?`,
      [val.recordid, val.switchtype, val.switchtime, id]
    );
    if (exists) return { code: -1, msg: '当前定时切换策略已存在' };

    await query(
      `UPDATE ${table('sctask')} SET did=?, rr=?, recordid=?, type=?, cycle=?, switchtype=?, switchdate=?, switchtime=?, value=?, line=?, remark=?, recordinfo=? WHERE id=?`,
      [val.did, val.rr, val.recordid, val.type, val.cycle, val.switchtype, val.switchdate, val.switchtime, val.value, val.line, val.remark, val.recordinfo, id]
    );
    const row = await queryOne(`SELECT * FROM ${table('sctask')} WHERE id = ?`, [id]);
    if (row) await updateNexttime(row);
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/schedule/tasks/:id/active', auth, async (req: any) => {
    const id = Number(req.params.id);
    const active = Number((req.body || {}).active);
    await query(`UPDATE ${table('sctask')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: '设置成功' };
  });

  app.delete('/api/schedule/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM ${table('sctask')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/schedule/tasks/batch', auth, async (req: any) => {
    const { act, ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return { code: -1, msg: '参数错误' };
    let success = 0;
    for (const id of ids) {
      if (act === 'delete') {
        await query(`DELETE FROM ${table('sctask')} WHERE id = ?`, [id]);
        success++;
      } else if (act === 'open' || act === 'close') {
        await query(`UPDATE ${table('sctask')} SET active = ? WHERE id = ?`, [act === 'open' ? 1 : 0, id]);
        success++;
      }
    }
    return { code: 0, msg: '成功操作' + success + '个定时切换策略' };
  });
}

function buildTask(b: Record<string, any>) {
  return {
    did: Number(b.did),
    rr: (b.rr || '').trim(),
    recordid: (b.recordid || '').trim(),
    type: Number(b.type),
    cycle: Number(b.cycle),
    switchtype: Number(b.switchtype),
    switchdate: (b.switchdate !== undefined && b.switchdate !== null ? String(b.switchdate) : '').trim(),
    switchtime: (b.switchtime || '').trim(),
    value: (b.value || '').trim(),
    line: (b.line || '').trim(),
    remark: (b.remark || '').trim(),
    recordinfo: (b.recordinfo || '').trim(),
  };
}