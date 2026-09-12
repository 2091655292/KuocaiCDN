import nodemailer from 'nodemailer';
import { configGet } from '../../config.js';
import { query, table } from '../../db.js';
import { Aliyun } from '../clients/Aliyun.js';
import { fmtDateTime } from '../util.js';
import { certConfig } from '../cert/factory.js';
import { deployConfig } from '../deploy/meta.js';
import { STATUS_LABEL } from '../certService.js';

const SITENAME = '聚合DNS管理系统';

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function convertSecond(s: number): string {
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  if (m === 0) return total + '秒';
  const sec = total % 60;
  const h = Math.floor(m / 60);
  if (h === 0) return m + '分钟' + sec + '秒';
  const mm = m % 60;
  return h + '小时' + mm + '分钟' + sec + '秒';
}

export async function sendMail(to: string, sub: string, msg: string): Promise<boolean | string> {
  const mailType = (await configGet('mail_type')) || '0';
  if (mailType === '1') {
    // Sendcloud
    const apiUser = await configGet('mail_apiuser');
    const apiKey = await configGet('mail_apikey');
    const from = await configGet('mail_name');
    if (!apiUser || !apiKey) return false;
    const res = await fetch('http://api.sendcloud.net/apiv2/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apiUser, apiKey, from: from || '', fromName: SITENAME, to, subject: sub, html: msg }),
    });
    const arr: any = await res.json().catch(() => null);
    if (arr && arr.statusCode === 200) return true;
    return arr && Array.isArray(arr.message) ? arr.message.join('\n') : '请求失败';
  } else if (mailType === '2') {
    // Aliyun DM
    const accessKeyId = await configGet('mail_apiuser');
    const accessKeySecret = await configGet('mail_apikey');
    const from = await configGet('mail_name');
    if (!accessKeyId || !accessKeySecret) return false;
    const client = new Aliyun(accessKeyId, accessKeySecret, 'dm.aliyuncs.com', '2015-11-23');
    try {
      await client.request({
        Action: 'SingleSendMail',
        AccountName: from || '',
        ReplyToAddress: 'false',
        AddressType: 1,
        ToAddress: to,
        FromAlias: SITENAME,
        Subject: sub,
        HtmlBody: msg,
      });
      return true;
    } catch (e: any) {
      return e.message;
    }
  } else {
    const mailName = await configGet('mail_name');
    const mailPort = parseInt((await configGet('mail_port')) || '0');
    const mailSmtp = await configGet('mail_smtp');
    const mailPwd = await configGet('mail_pwd');
    if (!mailName || !mailPort || !mailSmtp || !mailPwd) return false;
    const transporter = nodemailer.createTransport({
      host: mailSmtp,
      port: mailPort,
      secure: mailPort >= 465,
      auth: { user: mailName, pass: mailPwd },
      connectionTimeout: 5000,
      tls: mailPort === 587 ? {} : undefined,
    });
    try {
      await transporter.sendMail({
        from: `"${SITENAME}" <${mailName}>`,
        to,
        subject: sub,
        html: msg,
      });
      return true;
    } catch (e: any) {
      return e.message;
    }
  }
}

export async function sendWechat(sub: string, content: string): Promise<boolean | string> {
  const apptoken = await configGet('wechat_apptoken');
  const appuid = await configGet('wechat_appuid');
  if (!apptoken || !appuid) return false;
  const res = await fetch('https://wxpusher.zjiecode.com/api/send/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ appToken: apptoken, content, summary: sub, contentType: 3, uids: [appuid] }),
  });
  const arr: any = await res.json().catch(() => null);
  if (arr && arr.success === true) return true;
  return (arr && arr.msg) || '请求失败';
}

export async function sendTelegram(content: string): Promise<boolean | string> {
  const token = await configGet('tgbot_token');
  const chatid = await configGet('tgbot_chatid');
  if (!token || !chatid) return false;
  let base = 'https://api.telegram.org';
  if ((await configGet('tgbot_proxy')) === '2') {
    const u = await configGet('tgbot_url');
    if (u) base = u.replace(/\/+$/, '');
  }
  const post: Record<string, any> = { chat_id: chatid, text: content, parse_mode: 'HTML' };
  const topicid = parseInt((await configGet('tgbot_topicid')) || '0');
  if (topicid > 0) post.message_thread_id = topicid;
  const res = await fetch(`${base}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(post).map(([k, v]) => [k, String(v)]))),
  });
  const arr: any = await res.json().catch(() => null);
  if (arr && arr.ok === true) return true;
  return (arr && arr.description) || '请求失败';
}

export async function sendWebhook(sub: string, content: string): Promise<boolean | string> {
  const url = await configGet('webhook_url');
  const atuser = await configGet('webhook_user');
  if (!url) return false;
  let post: Record<string, any>;
  if (url.includes('oapi.dingtalk.com')) {
    const text = '### ' + sub + "  \n " + content.replace(/\n/g, "  \n ");
    post = { msgtype: 'markdown', markdown: { title: sub, text } };
    if (atuser) {
      if (atuser === 'all') post.at = { isAtAll: true };
      else post.at = { atMobiles: atuser.split(','), isAtAll: false };
    }
  } else if (url.includes('qyapi.weixin.qq.com')) {
    const text = '## ' + sub + '\n' + content;
    post = { msgtype: 'markdown', markdown: { content: text } };
  } else if (url.includes('open.feishu.cn') || url.includes('open.larksuite.com')) {
    let text = content.replace('<font color="warning">', '<font color="red">');
    if (atuser) {
      if (atuser === 'all') {
        text += '\n<at id=all></at> ';
      } else {
        text += '\n';
        for (const u of atuser.split(',')) text += `<at user_id="${u}"></at> `;
      }
    }
    let template = 'blue';
    if (sub.includes('发生告警') || sub.includes('失败')) template = 'red';
    else if (sub.includes('恢复正常')) template = 'green';
    else if (sub.includes('到期提醒')) template = 'yellow';
    post = {
      msg_type: 'interactive',
      card: {
        schema: '2.0',
        config: { update_multi: true, style: { text_size: { normal_v2: { default: 'normal', pc: 'normal', mobile: 'heading' } } } },
        header: { title: { tag: 'plain_text', content: sub }, subtitle: { tag: 'plain_text', content: '' }, template, padding: '12px 12px 12px 12px' },
        body: { direction: 'vertical', padding: '12px 12px 12px 12px', elements: [{ tag: 'markdown', content: text, text_align: 'left', text_size: 'normal_v2', margin: '0px 0px 0px 0px' }] },
      },
    };
  } else {
    return '不支持的Webhook地址';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(post),
  });
  const arr: any = await res.json().catch(() => null);
  if ((arr && arr.errcode === 0) || (arr && arr.code === 0)) return true;
  return (arr && (arr.errmsg || arr.msg)) || '请求失败';
}

export async function sendCustomWebhook(sub: string, content: string): Promise<boolean | string> {
  const url = await configGet('custom_webhook_url');
  if (!url) return false;
  const method = ((await configGet('custom_webhook_method')) || 'POST').toUpperCase();
  const contentType = (await configGet('custom_webhook_content_type')) || 'application/json';
  const headersRaw = await configGet('custom_webhook_headers');
  const bodyTemplate = (await configGet('custom_webhook_body')) || '{"title":"{title}","content":"{content}"}';
  const contentFormat = (await configGet('custom_webhook_content_format')) || 'text';

  let c = content;
  if (contentFormat === 'markdown') {
    c = stripTags(content.replace(/<br\/>/g, '\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**'));
  } else {
    c = stripTags(content.replace(/<br\/>/g, '\n'));
  }

  const body = bodyTemplate.replace(/\{title\}/g, sub).replace(/\{content\}/g, c);

  const headers: Record<string, string> = {};
  if (headersRaw) {
    for (const line of headersRaw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const pos = l.indexOf(':');
      if (pos >= 0) {
        const key = l.slice(0, pos).trim();
        const val = l.slice(pos + 1).trim();
        if (key) headers[key] = val;
      }
    }
  }

  let fetchUrl = url;
  let bodyToSend: string | undefined;
  let methodToUse = method === 'GET' ? 'GET' : method;

  if (method === 'GET') {
    let params: Record<string, string> = {};
    if (contentType === 'application/json') {
      try {
        params = JSON.parse(body);
      } catch {
        params = {};
      }
    } else {
      params = Object.fromEntries(new URLSearchParams(body));
    }
    const qs = new URLSearchParams(params).toString();
    fetchUrl = url + (url.includes('?') ? '&' : '?') + qs;
  } else {
    headers['Content-Type'] = contentType;
    bodyToSend = body;
  }

  try {
    const res = await fetch(fetchUrl, { method: methodToUse, headers, body: bodyToSend });
    if (res.status >= 200 && res.status < 300) return true;
    return '请求失败，HTTP状态码：' + res.status;
  } catch (e: any) {
    return '请求失败：' + e.message;
  }
}

export interface NoticeTask {
  domain: string;
  type: number;
  main_value: string;
  backup_value?: string;
  remark?: string;
  switchtime?: number;
}

export async function sendNotice(action: number, task: NoticeTask, result: CheckResultLike): Promise<void> {
  let mailTitle: string;
  let mailContent: string;
  if (action === 1) {
    mailTitle = 'DNS容灾切换-发生告警通知';
    mailContent = `尊敬的用户，您好：<br/>您的域名 <b>${task.domain}</b> 的 <b>${task.main_value}</b> 记录发生了异常`;
    if (task.type === 2) {
      mailContent += `，已自动切换为备用解析记录 ${task.backup_value} `;
    } else if (task.type === 1) {
      mailContent += '，已自动暂停解析';
    } else {
      mailContent += '，请及时处理';
    }
    if (result.errmsg) {
      mailContent += `。<br/>异常信息：<font color="warning">${result.errmsg}</font>`;
    }
  } else {
    mailTitle = 'DNS容灾切换-恢复正常通知';
    mailContent = `尊敬的用户，您好：<br/>您的域名 <b>${task.domain}</b> 的 <b>${task.main_value}</b> 记录已恢复正常`;
    if (task.type === 2) {
      mailContent += '，已自动切换回当前解析记录';
    } else if (task.type === 1) {
      mailContent += '，已自动开启解析';
    }
    const lasttime = convertSecond(Date.now() / 1000 - (task.switchtime || 0));
    mailContent += '。<br/>异常持续时间：' + lasttime;
  }
  if (task.remark) {
    mailTitle += '(' + task.remark + ')';
    mailContent += '<br/>备注：' + task.remark;
  }
  mailContent += `<br/><font color="grey">${SITENAME}</font><br/><font color="grey">${fmtDateTime()}</font>`;

  if ((await configGet('notice_mail')) === '1') {
    const to = (await configGet('mail_recv')) || (await configGet('mail_name')) || '';
    if (to) await sendMail(to, mailTitle, mailContent);
  }
  if ((await configGet('notice_wxtpl')) === '1') {
    const content = stripTags(mailContent.replace(/<br\/>/g, '\n\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**'));
    await sendWechat(mailTitle, content);
  }
  if ((await configGet('notice_tgbot')) === '1') {
    const content = stripTags(mailContent.replace(/<br\/>/g, '\n'));
    await sendTelegram(`<strong>${mailTitle}</strong>\n${content}`);
  }
  if ((await configGet('notice_webhook')) === '1') {
    const content = mailContent.replace(/<br\/>/g, '\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**');
    await sendWebhook(mailTitle, content);
  }
  if ((await configGet('notice_custom_webhook')) === '1') {
    await sendCustomWebhook(mailTitle, mailContent);
  }
}

export async function sendExpireNotice(day: number, list: { name: string; expiretime: string }[]): Promise<void> {
  const title = `您有${list.length}个域名即将在${day}天后到期`;
  let content = `尊敬的用户，您好：您有${list.length}个域名即将在${day}天后到期！<br/><b>域名&到期时间：</b><br/>`;
  for (const d of list) content += `<b>${d.name}</b> - ${d.expiretime}<br/>`;
  content += `<br/><font color="grey">${SITENAME}</font><br/><font color="grey">${fmtDateTime()}</font>`;

  if ((await configGet('expire_notice_mail')) === '1') {
    const to = (await configGet('mail_recv')) || (await configGet('mail_name')) || '';
    if (to) await sendMail(to, title, content);
  }
  if ((await configGet('expire_notice_wxtpl')) === '1') {
    const c = stripTags(content.replace(/<br\/>/g, '\n\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**'));
    await sendWechat(title, c);
  }
  if ((await configGet('expire_notice_tgbot')) === '1') {
    const c = stripTags(content.replace(/<br\/>/g, '\n'));
    await sendTelegram(`<strong>${title}</strong>\n${c}`);
  }
  if ((await configGet('expire_notice_webhook')) === '1') {
    const c = content.replace(/<br\/>/g, '\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**');
    await sendWebhook(title, c);
  }
  if ((await configGet('expire_notice_custom_webhook')) === '1') {
    await sendCustomWebhook(title, content);
  }
}

async function certSend(title: string, content: string, result: boolean): Promise<void> {
  const on = async (key: string) => {
    const v = await configGet(key, '0');
    return v === '1' || (v === '2' && !result);
  };
  if (await on('cert_notice_mail')) {
    const to = (await configGet('mail_recv')) || (await configGet('mail_name')) || '';
    if (to) await sendMail(to, title, content);
  }
  if (await on('cert_notice_wxtpl')) {
    const c = stripTags(content.replace(/<br\/>/g, '\n\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**'));
    await sendWechat(title, c);
  }
  if (await on('cert_notice_tgbot')) {
    const c = stripTags(content.replace(/<br\/>/g, '\n'));
    await sendTelegram(`<strong>${title}</strong>\n${c}`);
  }
  if ((await configGet('cert_notice_webhook')) === '1') {
    const c = content.replace(/<br\/>/g, '\n').replace(/<b>/g, '**').replace(/<\/b>/g, '**');
    await sendWebhook(title, c);
  }
  if (await on('cert_notice_custom_webhook')) {
    await sendCustomWebhook(title, content);
  }
}

export async function certOrderSend(orderId: number, result: boolean): Promise<void> {
  const row: any = (await query(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [orderId]))?.[0];
  if (!row) return;
  const domainList: any[] = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [orderId]);
  const domains = domainList.map((d: any) => d.domain);
  if (!domains.length) return;

  let title = '';
  let content = '';
  if (row.aid == 0) {
    title = domains.length > 1 ? `${domains[0]}等${domains.length}个域名SSL证书即将到期提醒` : `${domains[0]}域名SSL证书即将到期提醒`;
    content = `尊敬的用户，您好：您有一张SSL证书将在${(await configGet('cert_renewdays', '7')) || '7'}天后到期，该证书为手动续期证书，请及时续期！<br/><b>证书域名：</b> ${domains.join('、')}<br/><b>签发时间：</b> ${row.issuetime || ''}<br/><b>到期时间：</b> ${row.expiretime || ''}<br/><b>颁发机构：</b> ${row.issuer || ''}`;
  } else {
    const acct: any = (await query(`SELECT type FROM ${table('cert_account')} WHERE id = ?`, [row.aid]))?.[0];
    const typename = certConfig[acct?.type]?.name || acct?.type || '未知';
    if (result) {
      title = domains.length > 1 ? `${domains[0]}等${domains.length}个域名SSL证书签发成功通知` : `${domains[0]}域名SSL证书签发成功通知`;
      content = `尊敬的用户，您好：您的SSL证书已签发成功！<br/><b>证书账户：</b> ${typename}(${row.aid})<br/><b>证书域名：</b> ${domains.join('、')}<br/><b>签发时间：</b> ${row.issuetime || ''}<br/><b>到期时间：</b> ${row.expiretime || ''}<br/><b>颁发机构：</b> ${row.issuer || ''}`;
    } else {
      const statusName = STATUS_LABEL[row.status] || '处理失败';
      title = domains.length > 1 ? `${domains[0]}等${domains.length}个域名SSL证书${statusName}通知` : `${domains[0]}域名SSL证书${statusName}通知`;
      content = `尊敬的用户，您好：您的SSL证书${statusName}！<br/><b>证书账户：</b> ${typename}(${row.aid})<br/><b>证书域名：</b> ${domains.join('、')}<br/><b>失败时间：</b> ${fmtDateTime()}<br/><b>失败原因：</b> <font color="warning">${row.error || ''}</font>`;
    }
  }
  content += `<br/><font color="grey">${SITENAME}</font><br/><font color="grey">${fmtDateTime()}</font>`;

  await certSend(title, content, result);
  await query(`UPDATE ${table('cert_order')} SET issend = 1 WHERE id = ?`, [orderId]);
}

export async function certDeploySend(deployId: number, result: boolean): Promise<void> {
  const row: any = (await query(`SELECT * FROM ${table('cert_deploy')} WHERE id = ?`, [deployId]))?.[0];
  if (!row) return;
  const account: any = (await query(`SELECT id, type, name, remark FROM ${table('cert_account')} WHERE id = ?`, [row.aid]))?.[0];
  if (!account) return;
  const domainList: any[] = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ?`, [row.oid]);
  const domains = domainList.map((d: any) => d.domain);
  const typename = deployConfig[account.type]?.name || account.type || '未知';

  let title = typename;
  if (row.remark) title += `(${row.remark})`;
  title += `SSL证书部署${result ? '成功' : '失败'}通知`;
  let content: string;
  if (result) {
    content = `尊敬的用户，您好：您的SSL证书已成功部署到${typename}！<br/><b>自动部署账户：</b> [${account.id}]${typename}(${account.remark ? account.remark : account.name})<br/><b>关联SSL证书：</b> [${row.oid}]${domains.join('、')}<br/><b>任务备注：</b> ${row.remark ? row.remark : '无'}`;
  } else {
    content = `尊敬的用户，您好：您的SSL证书部署失败！<br/><b>失败原因：</b> <font color="warning">${row.error || ''}</font><br/><b>自动部署账户：</b> [${account.id}]${typename}(${account.remark ? account.remark : account.name})<br/><b>关联SSL证书：</b> [${row.oid}]${domains.join('、')}<br/><b>任务备注：</b> ${row.remark ? row.remark : '无'}`;
  }
  content += `<br/><font color="grey">${SITENAME}</font><br/><font color="grey">${fmtDateTime()}</font>`;

  await certSend(title, content, result);
  await query(`UPDATE ${table('cert_deploy')} SET issend = 1 WHERE id = ?`, [deployId]);
}

type CheckResultLike = { status: boolean; errmsg: string | null };