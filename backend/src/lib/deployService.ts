import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, table } from '../db.js';
import { getDeployProvider } from './deploy/factory.js';
import type { DeployProvider } from './deploy/types.js';
import { genSid } from './certService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'runtime', 'log');

function safeJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export class CertDeployService {
  private client!: DeployProvider;
  private task: any;
  private info: any;

  constructor(private tid: number) {}

  private async load() {
    const task = await queryOne(`SELECT * FROM ${table('cert_deploy')} WHERE id = ?`, [this.tid]);
    if (!task) throw new Error('该自动部署任务不存在');
    this.task = task;

    const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ?`, [task.aid]);
    if (!account) throw new Error('该自动部署账户不存在');
    this.client = getDeployProvider(account.type, safeJson(account.config) || {});
    if (!this.client) throw new Error('该自动部署任务类型不存在');
    this.info = safeJson(task.info) || {};
  }

  private saveLog(txt: string) {
    if (!this.task.processid) return;
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, this.task.processid + '.log'), txt + '\n');
  }

  private async saveResult(status: number, error: string | null = null, retrytime: string | null = null) {
    this.task.status = status;
    let err = error;
    if (err && err.length > 300) err = err.slice(0, 300);
    const update: any = { status, error: err ? err.replace(/[\r\n]/g, '') : null, retrytime: retrytime ? new Date(retrytime) : null };
    if (status === 1) {
      update.retry = 0;
      update.lasttime = new Date();
    }
    if (status < 0 || retrytime) {
      this.task.retry = (this.task.retry || 0) + 1;
      update.retry = this.task.retry;
    }
    await query(`UPDATE ${table('cert_deploy')} SET ? WHERE id = ?`, [update, this.tid]);
    if (err) this.saveLog('[Error] ' + err);
  }

  private async lockTask() {
    if (!this.task.processid) this.task.processid = genSid();
    await query(`UPDATE ${table('cert_deploy')} SET islock = 1, locktime = NOW(), processid = ? WHERE id = ?`, [this.task.processid, this.tid]);
  }

  private async unlockTask() {
    await query(`UPDATE ${table('cert_deploy')} SET islock = 0 WHERE id = ?`, [this.tid]);
  }

  async process(isManual = false): Promise<void> {
    await this.load();
    if (this.task.status >= 1) return;
    if (this.task.retry >= 6 && !isManual) throw new Error('已超出最大重试次数(' + this.task.error + ')');

    const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [this.task.oid]);
    if (!order) throw new Error('SSL证书订单不存在');
    if (order.status === 4) throw new Error('SSL证书订单已吊销');
    if (order.status !== 3) throw new Error('SSL证书订单未完成签发');
    if (!order.fullchain || !order.privatekey) throw new Error('SSL证书或私钥内容不存在');

    await this.lockTask();
    try {
      await this.deploy(order.fullchain, order.privatekey);
    } finally {
      await this.unlockTask();
    }
  }

  private async deploy(fullchain: string, privatekey: string): Promise<void> {
    this.client.setLogger((txt) => this.saveLog(txt));
    this.saveLog(new Date().toISOString());
    const config = safeJson(this.task.config) || {};
    const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [this.task.oid]);
    config.domainList = domains.map((d: any) => d.domain);
    try {
      await this.client.deploy(fullchain, privatekey, config, this.info);
      await this.saveResult(1);
      this.saveLog('[Success] 证书部署成功');
    } catch (e: any) {
      const iv = [60, 300, 600, 1800, 3600][this.task.retry] ?? 3600;
      await this.saveResult(-1, e.message, new Date(Date.now() + iv * 1000).toISOString().slice(0, 19).replace('T', ' '));
      throw e;
    } finally {
      if (this.info && typeof this.info === 'object') {
        if (this.info.config && typeof this.info.config === 'object') {
          const merged = { ...(safeJson(this.task.config) || {}), ...this.info.config };
          await query(`UPDATE ${table('cert_deploy')} SET config = ? WHERE id = ?`, [JSON.stringify(merged), this.tid]);
          delete this.info.config;
        }
        if (Object.keys(this.info).length) {
          await query(`UPDATE ${table('cert_deploy')} SET info = ? WHERE id = ?`, [JSON.stringify(this.info), this.tid]);
        }
      }
    }
  }

  async reset(): Promise<void> {
    await query(`UPDATE ${table('cert_deploy')} SET status = 0, retry = 0, retrytime = NULL, issend = 0, islock = 0 WHERE id = ?`, [this.tid]);
  }
}