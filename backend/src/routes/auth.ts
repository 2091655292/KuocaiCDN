import type { FastifyInstance } from 'fastify';
import { findUserByUsername, verifyPassword, findUserById } from '../auth.js';
import { query, table } from '../db.js';
import { generateSecret, provisioningUri, verifyTOTP } from '../lib/totp.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req: any) => {
    const { username, password } = req.body || {};
    if (!username || !password) return { code: -1, msg: '用户名或密码不能为空' };
    const user = await findUserByUsername(username);
    if (!user) return { code: -1, msg: '用户名或密码错误' };
    if (user.status == 0) return { code: -1, msg: '此用户已被封禁' };
    const ok = await verifyPassword(user.password, password);
    if (!ok) return { code: -1, msg: '用户名或密码错误' };
    if (user.totp_open == 1 && user.totp_secret) {
      const preToken = (app as any).jwt.sign({ uid: user.id, type: 'totp_pre' }, { expiresIn: '5m' });
      return { code: -1, msg: '需要验证动态口令', vcode: 2, data: { pre_token: preToken } };
    }
    const payload = { uid: user.id, username: user.username, level: user.level, totp_open: user.totp_open };
    const token = (app as any).jwt.sign(payload);
    await query(`UPDATE ${table('user')} SET lasttime = NOW() WHERE id = ?`, [user.id]);
    await query(`INSERT INTO ${table('log')} (uid, action, data, addtime) VALUES (?, ?, ?, NOW())`, [
      user.id,
      '登录后台',
      'IP:' + (req.ip || ''),
    ]);
    return {
      code: 0,
      msg: '登录成功',
      data: { token, user: { id: user.id, username: user.username, level: user.level, totp_open: user.totp_open } },
    };
  });

  app.post('/api/auth/totp', async (req: any) => {
    const { pre_token, code } = req.body || {};
    if (!pre_token) return { code: -1, msg: '请重新登录' };
    if (!code) return { code: -1, msg: '请输入动态口令' };
    let decoded: any;
    try {
      decoded = (app as any).jwt.verify(pre_token);
    } catch {
      return { code: -1, msg: '验证已过期，请重新登录' };
    }
    if (decoded.type !== 'totp_pre') return { code: -1, msg: '请重新登录' };
    const user = await findUserById(decoded.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    if (user.totp_open != 1 || !user.totp_secret) return { code: -1, msg: '未开启TOTP二次验证' };
    if (!verifyTOTP(user.totp_secret, code)) return { code: -1, msg: '动态口令错误' };

    const payload = { uid: user.id, username: user.username, level: user.level, totp_open: user.totp_open };
    const token = (app as any).jwt.sign(payload);
    await query(`UPDATE ${table('user')} SET lasttime = NOW() WHERE id = ?`, [user.id]);
    await query(`INSERT INTO ${table('log')} (uid, action, data, addtime) VALUES (?, ?, ?, NOW())`, [
      user.id,
      '登录后台',
      'IP:' + (req.ip || ''),
    ]);
    return { code: 0, msg: '登录成功', data: { token, user: { id: user.id, username: user.username, level: user.level, totp_open: user.totp_open } } };
  });

  app.post('/api/auth/totp-config', { preHandler: (app as any).authenticate }, async (req: any) => {
    const { action, secret, code } = req.body || {};
    if (action === 'generate') {
      const s = generateSecret();
      return { code: 0, data: { secret: s, qrcode: provisioningUri(s, req.user.username, 'DNS Manager') } };
    } else if (action === 'bind') {
      if (!secret) return { code: -1, msg: '密钥不能为空' };
      if (!code) return { code: -1, msg: '请输入动态口令' };
      if (!verifyTOTP(secret, code)) return { code: -1, msg: '动态口令错误' };
      await query(`UPDATE ${table('user')} SET totp_open = 1, totp_secret = ? WHERE id = ?`, [secret, req.user.uid]);
      return { code: 0, msg: 'TOTP 二次验证绑定成功' };
    } else if (action === 'close') {
      await query(`UPDATE ${table('user')} SET totp_open = 0, totp_secret = NULL WHERE id = ?`, [req.user.uid]);
      return { code: 0, msg: '已关闭 TOTP 二次验证' };
    }
    return { code: -1, msg: '未知操作' };
  });

  app.get('/api/auth/me', { preHandler: (app as any).authenticate }, async (req: any) => {
    const user = await findUserById(req.user.uid);
    if (!user) return { code: -1, msg: '用户不存在' };
    return { code: 0, data: { id: user.id, username: user.username, level: user.level, totp_open: user.totp_open } };
  });
}