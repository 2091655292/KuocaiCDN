import type { FastifyInstance } from 'fastify';
import { query, queryOne, table } from '../db.js';
import { checkLevel } from '../auth.js';
import { configGet, configSet } from '../config.js';
import { updateDomainDate } from '../lib/expire/expireNoticeService.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

const KEYS = ['expire_noticedays', 'expire_notice_mail', 'expire_notice_wxtpl', 'expire_notice_tgbot', 'expire_notice_webhook', 'expire_notice_custom_webhook'];

export default async function expireRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  app.get('/api/expire/settings', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const data: Record<string, string | null> = {};
    for (const k of KEYS) data[k] = await configGet(k, '');
    return { code: 0, data };
  });

  app.post('/api/expire/settings', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const body = req.body || {};
    for (const k of KEYS) {
      if (k in body) await configSet(k, String(body[k] ?? ''));
    }
    return { code: 0, msg: '设置保存成功' };
  });

  app.post('/api/domains/:id/update-date', auth, async (req: any) => {
    const id = Number(req.params.id);
    const row: any = await queryOne(`SELECT id, name FROM ${table('domain')} WHERE id = ?`, [id]);
    if (!row) return { code: -1, msg: '域名不存在' };
    const res = await updateDomainDate(id, row.name);
    return res;
  });

  app.post('/api/domains/batch-notice', auth, async (req: any) => {
    const b = req.body || {};
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter((n: number) => n > 0) : [];
    const isNotice = b.is_notice == 1 ? 1 : 0;
    if (!ids.length) return { code: -1, msg: '请选择域名' };
    await query(`UPDATE ${table('domain')} SET is_notice = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [isNotice, ...ids]);
    return { code: 0, msg: isNotice ? '已开启到期提醒' : '已关闭到期提醒' };
  });
}