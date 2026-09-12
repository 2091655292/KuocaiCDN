import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, table } from '../db.js';
import { configGet } from '../config.js';
import { checkLevel } from '../auth.js';
import { sendMail } from '../lib/monitor/msgNotice.js';

const SITENAME = '聚合DNS管理系统';
const CODE_TTL_SECONDS = 10 * 60; // 验证码有效期 10 分钟
const RESEND_INTERVAL_MS = 60 * 1000; // 重发间隔 60 秒

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

function genDigitCode(len = 6): string {
  const start = 10 ** (len - 1);
  const end = 10 ** len - 1;
  return String(start + Math.floor(Math.random() * (end - start + 1)));
}

function genRegCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += alphabet[bytes[i] % alphabet.length];
  return 'REG-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function registerRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  const registerEnabled = async () => (await configGet('register_enable', '0')) === '1';
  const registerMode = async () => (await configGet('register_mode', 'email')) || 'email';

  // 公开：注册配置（供注册页展示）
  app.get('/api/register/config', async () => {
    return { code: 0, data: { enable: (await configGet('register_enable', '0')) === '1', mode: await registerMode() } };
  });

  // 公开：发送邮箱验证码
  app.post('/api/register/send-code', async (req: any) => {
    if (!(await registerEnabled())) return { code: -1, msg: '注册功能未开放' };
    if ((await registerMode()) !== 'email') return { code: -1, msg: '当前注册方式不支持邮箱验证' };
    const email = ((req.body?.email) || '').trim().toLowerCase();
    if (!isValidEmail(email)) return { code: -1, msg: '请输入正确的邮箱地址' };

    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE email = ? LIMIT 1`, [email]);
    if (exists) return { code: -1, msg: '该邮箱已被注册' };

    const latest = await queryOne<any>(`SELECT addtime FROM ${table('reg_verify')} WHERE email = ? ORDER BY id DESC LIMIT 1`, [email]);
    if (latest?.addtime) {
      const last = new Date(latest.addtime).getTime();
      if (Date.now() - last < RESEND_INTERVAL_MS) return { code: -1, msg: '发送过于频繁，请稍后再试' };
    }

    const code = genDigitCode(6);
    await query(
      `INSERT INTO ${table('reg_verify')} (email, code, type, used, expiretime, addtime) VALUES (?, ?, 'register', 0, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW())`,
      [email, code, CODE_TTL_SECONDS]
    );

    const content = `尊敬的用户，您好：<br/><br/>您正在注册 <b>${SITENAME}</b>，本次邮箱验证码为：<br/><br/><b style="font-size:24px;color:#3b6df0;">${code}</b><br/><br/>验证码 ${CODE_TTL_SECONDS / 60} 分钟内有效，请勿泄露给他人。<br/><br/><font color="grey">${SITENAME}</font>`;
    const result = await sendMail(email, '【' + SITENAME + '】邮箱验证码', content);
    if (result === true) return { code: 0, msg: '验证码已发送，请查收邮箱' };
    if (result === false) return { code: -1, msg: '邮件发送失败，请检查系统发信邮箱配置' };
    return { code: -1, msg: '邮件发送失败：' + result };
  });

  // 公开：注册
  app.post('/api/register', async (req: any) => {
    if (!(await registerEnabled())) return { code: -1, msg: '注册功能未开放' };
    const mode = await registerMode();
    const b = req.body || {};
    const username = (b.username || '').trim();
    const password = (b.password || '').trim();
    const email = (b.email || '').trim().toLowerCase();

    if (username.length < 3 || username.length > 32) return { code: -1, msg: '用户名长度需为 3-32 个字符' };
    if (password.length < 6) return { code: -1, msg: '密码长度至少为 6 位' };
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) return { code: -1, msg: '用户名仅支持字母、数字、下划线、点和横线' };

    const exists = await queryOne(`SELECT id FROM ${table('user')} WHERE username = ? LIMIT 1`, [username]);
    if (exists) return { code: -1, msg: '用户名已存在' };

    if (mode === 'email') {
      if (!isValidEmail(email)) return { code: -1, msg: '请输入正确的邮箱地址' };
      const code = (b.code || '').trim();
      if (!code) return { code: -1, msg: '请输入邮箱验证码' };
      const emailUsed = await queryOne(`SELECT id FROM ${table('user')} WHERE email = ? LIMIT 1`, [email]);
      if (emailUsed) return { code: -1, msg: '该邮箱已被注册' };
      const verify = await queryOne<any>(
        `SELECT * FROM ${table('reg_verify')} WHERE email = ? AND code = ? AND used = 0 AND expiretime > NOW() ORDER BY id DESC LIMIT 1`,
        [email, code]
      );
      if (!verify) return { code: -1, msg: '验证码错误或已过期' };
      await query(`UPDATE ${table('reg_verify')} SET used = 1 WHERE id = ?`, [verify.id]);
    } else {
      // 注册码模式
      const regCode = (b.reg_code || '').trim().toUpperCase();
      if (!regCode) return { code: -1, msg: '请输入注册码' };
      if (email && !isValidEmail(email)) return { code: -1, msg: '请输入正确的邮箱地址' };
      const codeRow = await queryOne<any>(`SELECT * FROM ${table('reg_code')} WHERE code = ? LIMIT 1`, [regCode]);
      if (!codeRow) return { code: -1, msg: '注册码无效' };
      if (codeRow.status !== 1) return { code: -1, msg: '该注册码已停用' };
      if (codeRow.expiretime && new Date(codeRow.expiretime).getTime() < Date.now()) return { code: -1, msg: '该注册码已过期' };
      if (codeRow.max_use > 0 && codeRow.used >= codeRow.max_use) return { code: -1, msg: '该注册码使用次数已用完' };
      await query(`UPDATE ${table('reg_code')} SET used = used + 1 WHERE id = ?`, [codeRow.id]);
    }

    const hash = bcrypt.hashSync(password, 10);
    await query(
      `INSERT INTO ${table('user')} (username, password, is_api, apikey, level, regtime, status, email) VALUES (?, ?, 0, '', 1, NOW(), 1, ?)`,
      [username, hash, email || null]
    );
    await query(`INSERT INTO ${table('log')} (uid, action, data, addtime) VALUES ((SELECT id FROM ${table('user')} WHERE username = ?), '用户注册', ?, NOW())`, [username, 'IP:' + (req.ip || '')]);

    return { code: 0, msg: '注册成功，请登录' };
  });

  // ===== 管理员：注册码管理 =====

  app.get('/api/register/codes', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const q = req.query || {};
    const offset = Number(q.offset || 0);
    const limit = Number(q.limit || 10);
    const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table('reg_code')}`);
    const list = await query(
      `SELECT * FROM ${table('reg_code')} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { code: 0, data: { total: totalRow?.c ?? 0, list } };
  });

  app.post('/api/register/codes', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const b = req.body || {};
    const count = Math.min(Math.max(Number(b.count || 1), 1), 100);
    const days = Math.max(Number(b.days || 0), 0);
    const maxUse = Math.max(Number(b.max_use || 0), 0);
    const remark = (b.remark || '').trim();

    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      let code = genRegCode();
      let guard = 0;
      while ((await queryOne(`SELECT id FROM ${table('reg_code')} WHERE code = ?`, [code])) && guard++ < 10) {
        code = genRegCode();
      }
      codes.push(code);
      const expiretime = days > 0 ? `DATE_ADD(NOW(), INTERVAL ${days} DAY)` : 'NULL';
      await query(
        `INSERT INTO ${table('reg_code')} (code, expiretime, max_use, used, status, remark, addtime) VALUES (?, ${expiretime}, ?, 0, 1, ?, NOW())`,
        [code, maxUse, remark || null]
      );
    }
    return { code: 0, msg: '注册码生成成功', data: { codes } };
  });

  app.post('/api/register/codes/:id/status', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    const status = Number(req.body?.status) === 0 ? 0 : 1;
    await query(`UPDATE ${table('reg_code')} SET status = ? WHERE id = ?`, [status, id]);
    return { code: 0, msg: '设置成功' };
  });

  app.delete('/api/register/codes/:id', auth, async (req: any) => {
    if (!checkLevel(req.user, 2)) return { code: -1, msg: '无权限' };
    const id = Number(req.params.id);
    await query(`DELETE FROM ${table('reg_code')} WHERE id = ?`, [id]);
    return { code: 0, msg: '删除成功' };
  });
}