import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { configGet } from '../config.js';
import { fmtDateTime, fmtTimestamp } from '../lib/util.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function fmt(ts: number): string {
  return fmtTimestamp(ts);
}

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

export default async function dmonitorRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/dmonitor/overview', auth, async () => {
    const day = fmtDateTime(new Date(Date.now() - 24 * 3600 * 1000));
    const switchCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE date >= ?`, [day]);
    const failCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE date >= ? AND action = 1`, [day]);

    const runTime = await configGet('run_time');
    let runState = 0;
    if (runTime) {
      const t = new Date(runTime.replace(/-/g, '/')).getTime();
      runState = Date.now() - t > 10000 ? 0 : 1;
    }

    return {
      code: 0,
      data: {
        run_count: parseInt((await configGet('run_count')) || '0'),
        run_time: runTime || '无',
        run_state: runState,
        run_error: await configGet('run_error'),
        switch_count: switchCount?.c ?? 0,
        fail_count: failCount?.c ?? 0,
      },
    };
  });

  app.get('/api/dmonitor/domains', auth, async () => {
    const rows = await query(
      `SELECT A.id, A.name, B.type FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id ORDER BY A.id DESC`
    );
    return { code: 0, data: rows };
  });

  app.get('/api/dmonitor/tasks', auth, async (req: any) => {
    const q = req.query || {};
    const kw = q.kw || '';
    const status = q.status;
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);
    const sort = q.sortName || '';
    const orderDir = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const searchType = Number(q.type || 1);

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
        where += ' AND A.main_value = ?';
        params.push(kw);
      } else if (searchType === 4) {
        where += ' AND A.backup_value = ?';
        params.push(kw);
      } else if (searchType === 5) {
        where += ' AND A.remark LIKE ?';
        params.push('%' + kw + '%');
      }
    }
    if (!isNullOrEmpty(status)) {
      where += ' AND A.status = ?';
      params.push(Number(status));
    }

    const totalRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where}`,
      params
    );
    const total = totalRow?.c ?? 0;

    const allowedSort: Record<string, string> = {
      id: 'A.id', rr: 'A.rr', main_value: 'A.main_value', type: 'A.type', checktype: 'A.checktype',
      frequency: 'A.frequency', status: 'A.status', active: 'A.active', checktimestr: 'A.checktime',
      addtimestr: 'A.addtime', remark: 'A.remark',
    };
    const orderBy = allowedSort[sort] ? `${allowedSort[sort]} ${orderDir}` : 'A.id DESC';

    const list = await query(
      `SELECT A.*, B.name AS domain FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE 1=1${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const rows = list.map((r: any) => ({
      ...r,
      addtimestr: fmt(r.addtime),
      checktimestr: r.checktime > 0 ? fmt(r.checktime) : '未运行',
    }));

    return { code: 0, data: { total, list: rows } };
  });

  app.post('/api/dmonitor/tasks', auth, async (req: any) => {
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      recordid: (b.recordid || '').trim(),
      type: Number(b.type),
      main_value: (b.main_value || '').trim(),
      backup_value: (b.backup_value || '').trim(),
      checktype: Number(b.checktype),
      checkurl: (b.checkurl || '').trim(),
      tcpport: b.tcpport ? Number(b.tcpport) : null,
      frequency: Number(b.frequency),
      cycle: Number(b.cycle),
      timeout: Number(b.timeout),
      proxy: Number(b.proxy || 0),
      cdn: b.cdn === true || b.cdn === 'true' || b.cdn === 1 || b.cdn === '1' ? 1 : 0,
      remark: (b.remark || '').trim(),
      recordinfo: (b.recordinfo || '').trim(),
      addtime: Math.floor(Date.now() / 1000),
      active: 1,
    };

    if (!task.did || !task.rr || !task.recordid || !task.main_value || !task.frequency || !task.cycle) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (task.checktype > 0 && task.timeout > task.frequency) {
      return { code: -1, msg: '为保障容灾切换任务正常运行，最大超时时间不能大于检测间隔' };
    }
    if (task.type === 2 && task.backup_value === task.main_value) {
      return { code: -1, msg: '主备地址不能相同' };
    }
    const exists = await queryOne(`SELECT id FROM ${table('dmtask')} WHERE recordid = ?`, [task.recordid]);
    if (exists) return { code: -1, msg: '当前容灾切换策略已存在' };

    await query(
      `INSERT INTO ${table('dmtask')} (did, rr, recordid, type, main_value, backup_value, checktype, checkurl, tcpport, frequency, cycle, timeout, proxy, cdn, remark, recordinfo, addtime, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [task.did, task.rr, task.recordid, task.type, task.main_value, task.backup_value, task.checktype, task.checkurl, task.tcpport, task.frequency, task.cycle, task.timeout, task.proxy, task.cdn, task.remark, task.recordinfo, task.addtime, task.active]
    );
    return { code: 0, msg: '添加成功' };
  });

  app.put('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const task = {
      did: Number(b.did),
      rr: (b.rr || '').trim(),
      recordid: (b.recordid || '').trim(),
      type: Number(b.type),
      main_value: (b.main_value || '').trim(),
      backup_value: (b.backup_value || '').trim(),
      checktype: Number(b.checktype),
      checkurl: (b.checkurl || '').trim(),
      tcpport: b.tcpport ? Number(b.tcpport) : null,
      frequency: Number(b.frequency),
      cycle: Number(b.cycle),
      timeout: Number(b.timeout),
      proxy: Number(b.proxy || 0),
      cdn: b.cdn === true || b.cdn === 'true' || b.cdn === 1 || b.cdn === '1' ? 1 : 0,
      remark: (b.remark || '').trim(),
      recordinfo: (b.recordinfo || '').trim(),
    };

    if (!task.did || !task.rr || !task.recordid || !task.main_value || !task.frequency || !task.cycle) {
      return { code: -1, msg: '必填项不能为空' };
    }
    if (task.checktype > 0 && task.timeout > task.frequency) {
      return { code: -1, msg: '为保障容灾切换任务正常运行，最大超时时间不能大于检测间隔' };
    }
    if (task.type === 2 && task.backup_value === task.main_value) {
      return { code: -1, msg: '主备地址不能相同' };
    }
    const exists = await queryOne(`SELECT id FROM ${table('dmtask')} WHERE recordid = ? AND id <> ?`, [task.recordid, id]);
    if (exists) return { code: -1, msg: '当前容灾切换策略已存在' };

    await query(
      `UPDATE ${table('dmtask')} SET did=?, rr=?, recordid=?, type=?, main_value=?, backup_value=?, checktype=?, checkurl=?, tcpport=?, frequency=?, cycle=?, timeout=?, proxy=?, cdn=?, remark=?, recordinfo=? WHERE id=?`,
      [task.did, task.rr, task.recordid, task.type, task.main_value, task.backup_value, task.checktype, task.checkurl, task.tcpport, task.frequency, task.cycle, task.timeout, task.proxy, task.cdn, task.remark, task.recordinfo, id]
    );
    return { code: 0, msg: '修改成功' };
  });

  app.post('/api/dmonitor/tasks/:id/active', auth, async (req: any) => {
    const id = Number(req.params.id);
    const active = Number((req.body || {}).active);
    await query(`UPDATE ${table('dmtask')} SET active = ? WHERE id = ?`, [active, id]);
    return { code: 0, msg: '设置成功' };
  });

  app.delete('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM ${table('dmtask')} WHERE id = ?`, [id]);
    await query(`DELETE FROM ${table('dmlog')} WHERE taskid = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });

  app.post('/api/dmonitor/tasks/batch', auth, async (req: any) => {
    const { act, ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return { code: -1, msg: '参数错误' };
    let success = 0;
    for (const id of ids) {
      if (act === 'delete') {
        await query(`DELETE FROM ${table('dmtask')} WHERE id = ?`, [id]);
        await query(`DELETE FROM ${table('dmlog')} WHERE taskid = ?`, [id]);
        success++;
      } else if (act === 'retry') {
        await query(`UPDATE ${table('dmtask')} SET checknexttime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), id]);
        success++;
      } else if (act === 'open' || act === 'close') {
        await query(`UPDATE ${table('dmtask')} SET active = ? WHERE id = ?`, [act === 'open' ? 1 : 0, id]);
        success++;
      }
    }
    return { code: 0, msg: '成功操作' + success + '个容灾切换策略' };
  });

  app.get('/api/dmonitor/tasks/:id', auth, async (req: any) => {
    const id = Number(req.params.id);
    const task = await queryOne(
      `SELECT A.*, B.name AS domain FROM ${table('dmtask')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.id = ?`,
      [id]
    );
    if (!task) return { code: -1, msg: '切换策略不存在' };
    const day = fmtDateTime(new Date(Date.now() - 24 * 3600 * 1000));
    const switchCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE taskid = ? AND date >= ?`, [id, day]);
    const failCount = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE taskid = ? AND date >= ? AND action = 1`, [id, day]);
    task.switch_count = switchCount?.c ?? 0;
    task.fail_count = failCount?.c ?? 0;
    return { code: 0, data: task };
  });

  app.get('/api/dmonitor/tasks/:id/logs', auth, async (req: any) => {
    const id = Number(req.params.id);
    const q = req.query || {};
    const action = Number(q.action || 0);
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);
    let where = 'taskid = ?';
    const params: any[] = [id];
    if (action > 0) {
      where += ' AND action = ?';
      params.push(action);
    }
    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('dmlog')} WHERE ${where}`, params);
    const list = await query(`SELECT * FROM ${table('dmlog')} WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { code: 0, data: { total: totalRow?.c ?? 0, list } };
  });

  app.post('/api/dmonitor/clean', auth, async (req: any) => {
    const days = Number((req.body || {}).days);
    if (!days || days < 0) return { code: -1, msg: '参数错误' };
    const threshold = fmtDateTime(new Date(Date.now() - days * 24 * 3600 * 1000));
    await query(`DELETE FROM ${table('dmlog')} WHERE date < ?`, [threshold]);
    return { code: 0, msg: '清理成功' };
  });

  app.get('/api/dmonitor/status', auth, async () => {
    const runTime = await configGet('run_time');
    let runState = 0;
    if (runTime) {
      const t = new Date(runTime.replace(/-/g, '/')).getTime();
      runState = Date.now() - t > 10000 ? 0 : 1;
    }
    return runState === 1 ? { code: 0, data: 'ok' } : { code: 0, data: 'error' };
  });
}