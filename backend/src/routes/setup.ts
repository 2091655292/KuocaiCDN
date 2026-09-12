import type { FastifyInstance } from 'fastify';
import { isInstalled, performInstall, testConnection } from '../installer.js';
import { getDbConfig } from '../db.js';

export default async function setupRoutes(app: FastifyInstance) {
  // 安装状态（前端据此决定展示安装页还是登录页）
  app.get('/api/setup/status', async () => {
    const installed = await isInstalled();
    return { code: 0, data: { installed } };
  });

  // 测试数据库连接，并返回是否已初始化（已存在彩虹 DNS 数据表）
  app.post('/api/setup/check', async (req: any) => {
    const b = req.body || {};
    const cfg = {
      db_host: String(b.db_host || '').trim(),
      db_port: Number(b.db_port || 3306),
      db_user: String(b.db_user || '').trim(),
      db_password: String(b.db_password ?? ''),
      db_name: String(b.db_name || '').trim(),
      db_prefix: String(b.db_prefix || 'dnsmgr_').trim(),
    };
    if (!cfg.db_host || !cfg.db_user || !cfg.db_name) {
      return { code: -1, msg: '请完整填写数据库主机、用户名和数据库名' };
    }
    const result = await testConnection(cfg);
    if (!result.ok) return { code: -1, msg: result.message };
    return { code: 0, data: { initialized: result.initialized }, msg: result.initialized ? '连接成功，检测到已有数据' : '连接成功' };
  });

  // 执行安装：全新空库建表+创建管理员；已有表则绑定现有数据
  app.post('/api/setup/install', async (req: any) => {
    if (await isInstalled()) {
      return { code: -1, msg: '系统已安装' };
    }
    const b = req.body || {};
    const cfg = {
      db_host: String(b.db_host || '').trim(),
      db_port: Number(b.db_port || 3306),
      db_user: String(b.db_user || '').trim(),
      db_password: String(b.db_password ?? ''),
      db_name: String(b.db_name || '').trim(),
      db_prefix: String(b.db_prefix || 'dnsmgr_').trim(),
    };
    const adminUsername = String(b.admin_username || '').trim();
    const adminPassword = String(b.admin_password || '');

    if (!cfg.db_host || !cfg.db_user || !cfg.db_name) {
      return { code: -1, msg: '请完整填写数据库连接信息' };
    }
    const result = await performInstall(cfg, adminUsername, adminPassword);
    if (!result.ok) return { code: -1, msg: result.message };

    // 安装完成：保存配置后优雅退出，由容器编排/守护进程重启加载完整业务路由与调度器
    const message = result.bound
      ? '已绑定现有数据库（彩虹 DNS 数据），应用即将重启，请稍候…'
      : '安装完成，应用即将重启，请稍候…';
    setTimeout(() => {
      process.exit(0);
    }, 500);
    return { code: 0, msg: message, data: { bound: result.bound } };
  });
}