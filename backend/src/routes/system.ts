import type { FastifyInstance } from 'fastify';
import { query, table } from '../db.js';
import { configGet, configSet, loadConfig } from '../config.js';
import { ProxyAgent } from 'undici';
import { sendMail, sendTelegram, sendWebhook, sendCustomWebhook } from '../lib/monitor/msgNotice.js';
import { executeAll as runScheduleAll } from '../lib/schedule/scheduleService.js';
import { executeAll as runOptimizeAll } from '../lib/optimize/optimizeService.js';

const authenticate = (app: FastifyInstance) => ({ preHandler: (app as any).authenticate });

export default async function systemRoutes(app: FastifyInstance) {
  const auth = authenticate(app);

  // 获取全部系统配置
  app.get('/api/system/settings', auth, async () => {
    const cfg = await loadConfig();
    return { code: 0, data: cfg };
  });

  // 保存系统配置
  app.post('/api/system/settings', auth, async (req: any) => {
    const b = req.body || {};
    if (b.mail_type !== undefined && b.mail_name2 !== undefined && Number(b.mail_type) > 0) {
      b.mail_name = b.mail_name2;
      delete b.mail_name2;
    }
    for (const [key, value] of Object.entries(b)) {
      if (!key) continue;
      await configSet(key, String(value));
    }
    return { code: 0, msg: 'succ' };
  });

  // 发送测试邮件
  app.post('/api/system/mailtest', auth, async () => {
    const mailName = (await configGet('mail_recv')) || (await configGet('mail_name'));
    if (!mailName) return { code: -1, msg: '您还未设置邮箱！' };
    const result = await sendMail(mailName, '邮件发送测试。', '这是一封测试邮件！<br/><br/>来自：聚合DNS管理系统');
    if (result === true) return { code: 0, msg: '邮件发送成功！' };
    return { code: -1, msg: '邮件发送失败！' + (result as string) };
  });

  // 发送测试 Telegram
  app.post('/api/system/tgbottest', auth, async () => {
    const token = await configGet('tgbot_token');
    const chatid = await configGet('tgbot_chatid');
    if (!token || !chatid) return { code: -1, msg: '请先保存设置' };
    const content = '<strong>消息发送测试</strong>\n\n这是一封测试消息！\n\n来自：聚合DNS管理系统';
    const result = await sendTelegram(content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 发送测试 Webhook
  app.post('/api/system/webhooktest', auth, async () => {
    const url = await configGet('webhook_url');
    if (!url) return { code: -1, msg: '请先保存设置' };
    const content = '这是一封测试消息！\n来自：聚合DNS管理系统';
    const result = await sendWebhook('消息发送测试', content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 发送测试自定义 Webhook
  app.post('/api/system/customwebhooktest', auth, async () => {
    const url = await configGet('custom_webhook_url');
    if (!url) return { code: -1, msg: '请先保存设置' };
    const content = '这是一封测试消息！\n来自：聚合DNS管理系统';
    const result = await sendCustomWebhook('消息发送测试', content);
    if (result === true) return { code: 0, msg: '消息发送成功！' };
    return { code: -1, msg: '消息发送失败！' + (result as string) };
  });

  // 测试代理连通性
  app.post('/api/system/proxytest', auth, async (req: any) => {
    const b = req.body || {};
    const server = (b.proxy_server || '').trim();
    const port = Number(b.proxy_port || 0);
    const user = (b.proxy_user || '').trim();
    const pwd = (b.proxy_pwd || '').trim();
    const type = (b.proxy_type || 'http').trim();
    if (!server || !port) return { code: -1, msg: '代理服务器和端口不能为空' };

    let scheme = 'http';
    if (type === 'https') scheme = 'https';
    else if (type === 'sock4') scheme = 'socks4';
    else if (type === 'sock5') scheme = 'socks5';
    else if (type === 'sock5h') scheme = 'socks5h';

    const authPart = user && pwd ? `${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@` : '';
    const uri = `${scheme}://${authPart}${server}:${port}`;

    const targets = ['https://myip.ipip.net/', 'http://ip-api.com/'];
    const agent = new ProxyAgent(uri);
    let lastErr = '代理连接失败';
    for (const target of targets) {
      try {
        const res = await fetch(target, {
          dispatcher: agent,
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (res.status >= 200 && res.status < 400) {
          return { code: 0, msg: '连通性测试成功！' };
        }
        lastErr = 'HTTP状态码异常：' + res.status;
      } catch (e: any) {
        lastErr = e?.cause?.message || e?.message || '代理连接失败';
      }
    }
    return { code: -1, msg: lastErr };
  });

  // 计划任务触发（兼容 PHP cron URL，key 校验）
  app.get('/api/system/cron', async (req: any) => {
    const key = (req.query?.key || '').toString();
    const cronType = await configGet('cron_type', '0');
    const cronKey = await configGet('cron_key');
    if (cronType !== '1' || !cronKey) {
      return { code: -1, msg: '未开启当前方式' };
    }
    if (key !== cronKey) {
      return { code: -1, msg: '访问密钥错误' };
    }
    await runScheduleAll();
    const res = await runOptimizeAll();
    if (!res) {
      // 证书续签 + 到期提醒由内嵌调度器处理，这里仅兜底
    }
    return { code: 0, data: 'success!' };
  });

  // 生成/获取 cron key
  app.get('/api/system/cronkey', auth, async () => {
    let cronKey = await configGet('cron_key', '');
    if (!cronKey) {
      cronKey = Math.random().toString(36).slice(2, 12);
      await configSet('cron_key', cronKey);
    }
    const cronType = await configGet('cron_type', '0');
    return { code: 0, data: { cron_key: cronKey, cron_type: cronType } };
  });
}