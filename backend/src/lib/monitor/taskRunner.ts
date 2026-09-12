import { query, queryOne, table } from '../../db.js';
import { getDnsProvider } from '../dns/factory.js';
import { configSet } from '../../config.js';
import { fmtDateTime } from '../util.js';
import { checkPing, checkTcp, checkCurl, type CheckResult } from './checkUtils.js';
import { sendNotice } from './msgNotice.js';

function getDnsType(value: string): string {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'A';
  if (value.includes(':')) return 'AAAA';
  return 'CNAME';
}

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

async function insertLog(taskid: number, action: number, errmsg: string | null) {
  await query(`INSERT INTO ${table('dmlog')} (taskid, action, errmsg, date) VALUES (?, ?, ?, ?)`, [
    taskid,
    action,
    errmsg,
    fmtDateTime(),
  ]);
}

export async function runMonitorTask(row: any): Promise<void> {
  try {
    await handle(row);
  } catch (e: any) {
    await configSet('run_error', e.message || String(e));
    console.error('[dmtask] task ' + row.id + ' 失败:', e.message);
  }
}

async function handle(row: any): Promise<void> {
  let action = 0;
  let result: CheckResult = { status: false, errmsg: null, usetime: 0 };

  if (row.type === 3) {
    // 条件开启解析
    const remain = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${table('dmtask')} WHERE did = ? AND rr = ? AND type = 1 AND status = 0`,
      [row.did, row.rr]
    );
    const cnt = remain?.c ?? 0;
    if (cnt <= row.cycle && row.status === 0) {
      action = 2;
      await query(`UPDATE ${table('dmtask')} SET status = 1, errcount = 0, switchtime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), row.id]);
    } else if (cnt > row.cycle && row.status === 1) {
      action = 1;
      await query(`UPDATE ${table('dmtask')} SET status = 0, errcount = 0, switchtime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), row.id]);
    }
  } else {
    if (row.checktype === 2) {
      result = await checkCurl(row.checkurl, row.timeout, row.main_value, row.proxy === 1);
    } else if (row.checktype === 1) {
      result = await checkTcp(row.main_value, row.checkurl, row.tcpport, row.timeout);
    } else {
      result = await checkPing(row.main_value, row.checkurl);
    }

    action = 0;
    if (result.status && row.status === 1) {
      if (row.cycle <= 1 || row.errcount >= row.cycle) {
        await query(`UPDATE ${table('dmtask')} SET status = 0, errcount = 0, switchtime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), row.id]);
        action = 2;
      } else {
        await query(`UPDATE ${table('dmtask')} SET errcount = errcount + 1 WHERE id = ?`, [row.id]);
      }
    } else if (!result.status && row.status === 0) {
      if (row.cycle <= 1 || row.errcount >= row.cycle) {
        await query(`UPDATE ${table('dmtask')} SET status = 1, errcount = 0, switchtime = ? WHERE id = ?`, [Math.floor(Date.now() / 1000), row.id]);
        action = 1;
      } else {
        await query(`UPDATE ${table('dmtask')} SET errcount = errcount + 1 WHERE id = ?`, [row.id]);
      }
    } else if (row.errcount > 0) {
      await query(`UPDATE ${table('dmtask')} SET errcount = 0 WHERE id = ?`, [row.id]);
    }
  }

  let drow: any = null;
  if (action > 0) {
    drow = await queryOne(
      `SELECT A.*, B.type AS account_type, B.config AS account_config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
      [row.did]
    );
    if (!drow) {
      console.log('域名不存在（ID：' + row.did + '）');
      return;
    }
    row.domain = row.rr + '.' + drow.name;
  }

  if (action === 1) {
    if (row.type === 2) {
      const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const recordinfo = safeJson(row.recordinfo);
      if (drow.account_type === 'cloudflare' && row.cdn === 1) {
        recordinfo.Line = '1';
      }
      const res = await dns.updateDomainRecord(row.recordid, row.rr, getDnsType(row.backup_value), row.backup_value, recordinfo.Line, recordinfo.TTL);
      if (!res) {
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '修改解析失败', ?, ?)`, [drow.name, dns.getError(), fmtDateTime()]);
      }
    } else if (row.type === 1 || row.type === 3) {
      const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const res = await dns.setDomainRecordStatus(row.recordid, '0');
      if (!res) {
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '暂停解析失败', ?, ?)`, [drow.name, dns.getError(), fmtDateTime()]);
      }
    }
  } else if (action === 2) {
    if (row.type === 2) {
      const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const recordinfo = safeJson(row.recordinfo);
      if (drow.account_type === 'cloudflare' && row.cdn === 1) {
        recordinfo.Line = '0';
      }
      const res = await dns.updateDomainRecord(row.recordid, row.rr, getDnsType(row.main_value), row.main_value, recordinfo.Line, recordinfo.TTL);
      if (!res) {
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '修改解析失败', ?, ?)`, [drow.name, dns.getError(), fmtDateTime()]);
      }
    } else if (row.type === 1 || row.type === 3) {
      const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
      if (!dns) throw new Error('该厂商暂未支持');
      const res = await dns.setDomainRecordStatus(row.recordid, '1');
      if (!res) {
        await query(`INSERT INTO ${table('log')} (uid, domain, action, data, addtime) VALUES (0, ?, '启用解析失败', ?, ?)`, [drow.name, dns.getError(), fmtDateTime()]);
      }
    }
  } else {
    return;
  }

  await insertLog(row.id, action, row.type !== 3 && result ? (result.status ? null : result.errmsg) : null);

  if (row.type !== 3) {
    await sendNotice(action, row, { status: result.status, errmsg: result.errmsg });
  }
}