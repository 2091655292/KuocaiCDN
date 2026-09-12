import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, appendFileSync, existsSync, unlinkSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, table } from '../db.js';
import { getCertProvider, certConfig } from './cert/factory.js';
import { addDns, delDns, verifyDns } from './certDns.js';
import type { CertProvider } from './cert/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'runtime', 'log');
export const STATUS_LABEL: Record<number, string> = {
  0: '待提交', 1: '待验证', 2: '正在验证', 3: '已签发', 4: '已吊销',
  [-1]: '购买证书失败', [-2]: '创建订单失败', [-3]: '添加DNS失败', [-4]: '验证DNS失败',
  [-5]: '验证订单失败', [-6]: '订单验证未通过', [-7]: '签发证书失败',
};

const RETRY_INTERVAL = [60, 180, 300, 600, 600];

function safeJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function genSid(): string {
  return Date.now().toString(36) + randomBytes(6).toString('hex');
}

export async function buildPfx(fullchain: string, privatekey: string, pwd = '123456'): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'pfx_'));
  const certFile = join(dir, 'fullchain.pem');
  const keyFile = join(dir, 'key.pem');
  const pfxFile = join(dir, 'out.pfx');
  try {
    writeFileSync(certFile, fullchain);
    writeFileSync(keyFile, privatekey);
    execFileSync('openssl', ['pkcs12', '-export', '-out', pfxFile, '-inkey', keyFile, '-in', certFile, '-passout', 'pass:' + pwd]);
    return readFileSync(pfxFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class CertOrderService {
  private client!: CertProvider;
  private aid: number;
  private atype: string;
  private order: any;
  private info: any;
  private dnsList: any;
  private domainList: string[];
  private cnameDomainList: number[] = [];
  private domainsAliasList: Record<string, string> = {};

  constructor(private oid: number) {}

  private async load() {
    const order = await queryOne(`SELECT * FROM ${table('cert_order')} WHERE id = ?`, [this.oid]);
    if (!order) throw new Error('该证书订单不存在');
    this.order = order;
    this.aid = order.aid;

    const account = await queryOne(`SELECT * FROM ${table('cert_account')} WHERE id = ?`, [this.aid]);
    if (!account) throw new Error('该证书账户不存在');
    this.atype = account.type;
    const config = safeJson(account.config) || {};
    const ext = safeJson(account.ext);
    this.client = getCertProvider(account.type, config, ext);
    if (!this.client) throw new Error('该证书类型不存在');

    const domains = await query(`SELECT domain FROM ${table('cert_domain')} WHERE oid = ? ORDER BY sort ASC`, [this.oid]);
    this.domainList = domains.map((d: any) => d.domain);
    if (!this.domainList.length) throw new Error('该证书订单没有绑定域名');
    this.info = safeJson(order.info);
    this.dnsList = safeJson(order.dns);
  }

  private saveLog(txt: string) {
    if (!this.order.processid) return;
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, this.order.processid + '.log'), txt + '\n');
  }

  private async saveResult(status: number, error: string | null = null, retrytime: string | null = null) {
    this.order.status = status;
    let err = error;
    if (err && err.length > 300) err = err.slice(0, 300);
    const update: any = {
      status,
      error: err ? err.replace(/[\r\n]/g, '') : null,
      updatetime: new Date(),
      retrytime: retrytime ? new Date(retrytime) : null,
    };
    if (status < 0 || retrytime) {
      this.order.retry = (this.order.retry || 0) + 1;
      update.retry = this.order.retry;
    }
    await query(`UPDATE ${table('cert_order')} SET ? WHERE id = ?`, [update, this.oid]);
    if (err) this.saveLog('[Error] ' + err);
  }

  private async resetRetry() {
    if ((this.order.retry || 0) > 0) {
      this.order.retry = 0;
      await query(`UPDATE ${table('cert_order')} SET retry = 0, retrytime = NULL WHERE id = ?`, [this.oid]);
    }
  }

  private async resetRetry2() {
    if ((this.order.retry2 || 0) > 0) {
      this.order.retry2 = 0;
      await query(`UPDATE ${table('cert_order')} SET retry2 = 0, retrytime = NULL WHERE id = ?`, [this.oid]);
    }
  }

  private async lockOrder() {
    const locked = await queryOne(`SELECT islock, locktime FROM ${table('cert_order')} WHERE id = ? FOR UPDATE`, [this.oid]).catch(() => null);
    const islock = locked ? locked.islock : this.order.islock;
    if (islock == 1 && Date.now() - new Date(this.order.locktime || 0).getTime() < 3600 * 1000) {
      throw new Error('订单正在处理中，请稍后再试');
    }
    if (!this.order.processid) this.order.processid = genSid();
    await query(`UPDATE ${table('cert_order')} SET islock = 1, locktime = NOW(), processid = ? WHERE id = ?`, [this.order.processid, this.oid]);
  }

  private async unlockOrder() {
    await query(`UPDATE ${table('cert_order')} SET islock = 0 WHERE id = ?`, [this.oid]);
  }

  private async checkDomains() {
    const cname = certConfig[this.atype]?.cname ?? false;
    for (let domain of this.domainList) {
      const mainDomain = await this.getMainDomain(domain);
      let drow = await queryOne(`SELECT name FROM ${table('domain')} WHERE name = ?`, [mainDomain]);
      if (!drow) {
        drow = await queryOne(`SELECT A.name AS alias, B.name AS maindomain FROM ${table('domain_alias')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.name = ?`, [mainDomain]);
        if (drow) {
          this.domainsAliasList[drow.alias] = drow.maindomain;
        }
      }
      if (!drow) {
        if (domain.startsWith('*.')) domain = domain.slice(2);
        const cnameRow = await queryOne(`SELECT id FROM ${table('cert_cname')} WHERE domain = ? AND status = 1`, [domain]);
        if (!cname || !cnameRow) {
          const errmsg = '域名' + domain + '未在本系统添加';
          await query(`UPDATE ${table('cert_order')} SET error = ? WHERE id = ?`, [errmsg, this.oid]);
          throw new Error(errmsg);
        } else {
          this.cnameDomainList.push(cnameRow.id);
        }
      }
    }
  }

  private async getMainDomain(host: string): Promise<string> {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return host;
    const rows = await query(`SELECT name FROM ${table('domain')}`);
    const aliasRows = await query(`SELECT name FROM ${table('domain_alias')}`);
    const domains = [...rows.map((r: any) => r.name), ...aliasRows.map((r: any) => r.name)].sort((a, b) => b.length - a.length);
    for (const d of domains) {
      if (host === d || host.endsWith('.' + d)) return d;
    }
    return host;
  }

  async process(isManual = false): Promise<number> {
    await this.load();
    if (this.order.status >= 3) return 3;
    if (this.order.retry2 >= 3 && !isManual) throw new Error('已超出最大重试次数(' + this.order.error + ')');
    if (this.order.status != 1 && this.order.status != 2 && this.order.retry >= 3 && !isManual) {
      if ([-2, -5, -6, -7].includes(this.order.status)) {
        await this.cancel();
        if (this.order.status <= -5) await this.delDns();
        await query(
          `UPDATE ${table('cert_order')} SET status = 0, retry = 0, retrytime = NULL, updatetime = NOW(), retry2 = retry2 + 1 WHERE id = ?`,
          [this.oid],
        );
        this.order.status = 0;
        this.order.retry = 0;
        this.order.retry2 = (this.order.retry2 || 0) + 1;
      } else {
        throw new Error('已超出最大重试次数(' + this.order.error + ')');
      }
    }

    await this.checkDomains();
    await this.lockOrder();
    try {
      return await this.processOrder(isManual);
    } finally {
      await this.unlockOrder();
    }
  }

  private async processOrder(isManual: boolean): Promise<number> {
    this.client.setLogger((txt) => this.saveLog(txt));

    if (this.order.status == 0 || this.order.status == -1) {
      this.saveLog(new Date().toISOString() + ' - 开始购买证书');
      await this.buyCert();
    }
    if (this.order.status == 0 || this.order.status == -2) {
      this.saveLog(new Date().toISOString() + ' - 开始创建订单');
      await this.createOrder();
    }
    if (isManual && this.order.status == -3 && (await verifyDns(this.dnsList || {}))) {
      await this.saveResult(1);
      this.saveLog('检测到DNS记录已添加成功');
      return 1;
    }
    if (this.order.status == 0 || this.order.status == -3) {
      this.saveLog(new Date().toISOString() + ' - 开始添加DNS记录');
      await this.addDns();
      this.saveLog('添加DNS记录成功，请等待生效后进行验证...');
      if (certConfig[this.atype]?.cname) {
        await query(`UPDATE ${table('cert_order')} SET retrytime = ? WHERE id = ?`, [new Date(Date.now() + 180 * 1000), this.oid]);
      }
      return 1;
    }
    if (this.order.status == 1 || this.order.status == -4) {
      await this.verifyDnsStep();
    }
    if (this.order.status == 1 || this.order.status == -5) {
      this.saveLog(new Date().toISOString() + ' - 开始验证订单');
      await this.authOrder();
    }
    if (this.order.status == 2 || this.order.status == -6) {
      this.saveLog(new Date().toISOString() + ' - 开始查询验证结果');
      await this.getAuthStatus();
    }
    if (this.order.status == 2 || this.order.status == -7) {
      this.saveLog(new Date().toISOString() + ' - 开始签发证书');
      await this.finalizeOrder();
    }
    await this.delDns();
    await this.resetRetry2();
    this.saveLog('[Success] 证书签发成功');
    await query(`UPDATE ${table('cert_deploy')} SET status = 0, retry = 0, retrytime = NULL, issend = 0 WHERE oid = ?`, [this.oid]);
    return 3;
  }

  async buyCert() {
    try {
      const res = await this.client.buyCert(this.domainList);
      if (res) this.info = res;
    } catch (e: any) {
      await this.saveResult(-1, e.message);
      throw e;
    }
    if (this.info) {
      await query(`UPDATE ${table('cert_order')} SET info = ? WHERE id = ?`, [JSON.stringify(this.info), this.oid]);
    }
    this.order.status = 0;
    await this.resetRetry();
  }

  async createOrder() {
    try {
      try {
        const { dnsList, order } = await this.client.createOrder(this.domainList, this.order.keytype, this.order.keysize, this.info);
        this.dnsList = dnsList;
        this.info = order;
      } catch (e: any) {
        if (String(e.message).includes('KeyID header contained an invalid account URL')) {
          const ext = await this.client.register();
          if (ext) {
            await query(`UPDATE ${table('cert_account')} SET ext = ? WHERE id = ?`, [JSON.stringify(ext), this.aid]);
          }
          const { dnsList, order } = await this.client.createOrder(this.domainList, this.order.keytype, this.order.keysize, this.info);
          this.dnsList = dnsList;
          this.info = order;
        } else {
          throw e;
        }
      }
    } catch (e: any) {
      await this.saveResult(-2, e.message);
      throw e;
    }

    for (const [alias, mainDomain] of Object.entries(this.domainsAliasList)) {
      if (this.dnsList[alias]) {
        if (!this.dnsList[mainDomain]) this.dnsList[mainDomain] = this.dnsList[alias];
        else this.dnsList[mainDomain] = this.dnsList[mainDomain].concat(this.dnsList[alias]);
        delete this.dnsList[alias];
      }
    }

    await query(
      `UPDATE ${table('cert_order')} SET info = ?, dns = ? WHERE id = ?`,
      [JSON.stringify(this.info), JSON.stringify(this.dnsList), this.oid],
    );

    if (this.dnsList && Object.keys(this.dnsList).length) {
      let dnsTxt = '需验证的DNS记录如下:';
      for (const [mainDomain, list] of Object.entries(this.dnsList)) {
        for (const row of list as any[]) {
          dnsTxt += '\n主机记录: ' + row.name + '.' + mainDomain + ' 类型: ' + row.type + ' 记录值: ' + row.value;
        }
      }
      this.saveLog(dnsTxt);
    }
    this.order.status = 0;
    await this.resetRetry();
  }

  async verifyDnsStep() {
    const ok = await verifyDns(this.dnsList || {});
    if (!ok) {
      if (this.order.retry >= 10) {
        await this.saveResult(-4, '未查询到DNS解析记录');
      } else {
        this.saveLog('未查询到DNS解析记录(尝试第' + (this.order.retry + 1) + '次)');
        const iv = RETRY_INTERVAL[this.order.retry] ?? 1800;
        await this.saveResult(1, null, new Date(Date.now() + iv * 1000).toISOString().slice(0, 19).replace('T', ' '));
      }
      throw new Error('未查询到DNS解析记录(尝试第' + this.order.retry + '次)，请稍后再试');
    }
    this.order.status = 1;
    await this.resetRetry();
  }

  async authOrder() {
    try {
      await this.client.authOrder(this.domainList, this.info);
    } catch (e: any) {
      await this.saveResult(-5, e.message);
      throw e;
    }
    await this.saveResult(2);
    await this.resetRetry();
  }

  async getAuthStatus() {
    let status: boolean;
    try {
      status = await this.client.getAuthStatus(this.domainList, this.info);
    } catch (e: any) {
      await this.saveResult(-6, e.message);
      throw e;
    }
    if (!status) {
      if (this.order.retry >= 10) {
        await this.saveResult(-6, '订单验证未通过');
      } else {
        this.saveLog('订单验证未通过(尝试第' + (this.order.retry + 1) + '次)');
        const iv = RETRY_INTERVAL[this.order.retry] ?? 1800;
        await this.saveResult(2, null, new Date(Date.now() + iv * 1000).toISOString().slice(0, 19).replace('T', ' '));
      }
      throw new Error('订单验证未通过(尝试第' + this.order.retry + '次)，请稍后再试');
    }
    this.order.status = 2;
    await this.resetRetry();
  }

  async finalizeOrder() {
    let result: any;
    try {
      result = await this.client.finalizeOrder(this.domainList, this.info, this.order.keytype, this.order.keysize);
    } catch (e: any) {
      await this.saveResult(-7, e.message);
      throw e;
    }
    await query(
      `UPDATE ${table('cert_order')} SET fullchain = ?, privatekey = ?, issuer = ?, issuetime = ?, expiretime = ? WHERE id = ?`,
      [
        result.fullchain,
        result.private_key,
        result.issuer,
        new Date(result.validFrom * 1000),
        new Date(result.validTo * 1000),
        this.oid,
      ],
    );
    await this.saveResult(3);
    await this.resetRetry();
  }

  async revoke() {
    this.client.setLogger((txt) => this.saveLog(txt));
    await this.client.revoke(this.info, this.order.fullchain);
    await this.saveResult(4);
  }

  async cancel() {
    this.client.setLogger((txt) => this.saveLog(txt));
    if (this.order.status == 1 || this.order.status == 2 || this.order.status < -2) {
      try {
        await this.client.cancel(this.info);
      } catch {
        // ignore
      }
    }
  }

  async addDns() {
    if (!this.dnsList || !Object.keys(this.dnsList).length) {
      await this.saveResult(1);
      return;
    }
    try {
      await addDns(this.dnsList, (txt) => this.saveLog(txt), this.cnameDomainList.length > 0);
    } catch (e: any) {
      await this.saveResult(-3, e.message);
      throw e;
    }
    await this.saveResult(1);
    await this.resetRetry();
  }

  async delDns() {
    if (!this.dnsList || !Object.keys(this.dnsList).length) return;
    try {
      await delDns(this.dnsList, (txt) => this.saveLog(txt), true);
    } catch (e: any) {
      this.saveLog('[Error] ' + e.message);
    }
  }

  async reset() {
    await query(
      `UPDATE ${table('cert_order')} SET status = 0, retry = 0, retry2 = 0, retrytime = NULL, processid = NULL, updatetime = NOW(), issend = 0, islock = 0 WHERE id = ?`,
      [this.oid],
    );
    const pid = this.order.processid;
    if (pid) {
      const f = join(LOG_DIR, pid + '.log');
      if (existsSync(f)) unlinkSync(f);
    }
  }
}