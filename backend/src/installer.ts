import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { saveDbConfig, type DbConfig } from './config-loader.js';
import { reinitPool, table, queryOne } from './db.js';

const SCHEMA_SQL = fs.readFileSync(fileURLToPath(new URL('./sql/schema-init.sql', import.meta.url)), 'utf8');

function randomStr(len: number): string {
  return randomBytes(len * 2)
    .toString('hex')
    .slice(0, len);
}

function friendlyDbError(e: any): string {
  const code = e?.code || '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') return '连接数据库失败：数据库地址或端口填写错误';
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return '连接数据库失败：数据库用户名或密码错误';
  if (code === 'ER_BAD_DB_ERROR') return '连接数据库失败：数据库名不存在';
  if (code === 'ER_DBACCESS_DENIED_ERROR') return '连接数据库失败：该用户无权限访问此数据库';
  return '连接数据库失败：' + (e?.message || String(e));
}

export interface ConnTestResult {
  ok: boolean;
  initialized: boolean;
  message: string;
}

async function createConnection(cfg: DbConfig): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: cfg.db_host,
    port: Number(cfg.db_port || 3306),
    user: cfg.db_user,
    password: cfg.db_password,
    database: cfg.db_name,
    connectTimeout: 8000,
    charset: 'utf8mb4',
  });
}

// 测试数据库连接，并判断是否已初始化（config 表已存在即视为已安装/已绑定现有库）
export async function testConnection(cfg: DbConfig): Promise<ConnTestResult> {
  let conn: mysql.Connection;
  try {
    conn = await createConnection(cfg);
  } catch (e) {
    return { ok: false, initialized: false, message: friendlyDbError(e) };
  }
  try {
    const prefix = cfg.db_prefix || 'dnsmgr_';
    const [rows] = await conn.query('SHOW TABLES LIKE ?', [prefix + 'config']);
    return { ok: true, initialized: (rows as any[]).length > 0, message: '' };
  } catch (e) {
    return { ok: false, initialized: false, message: friendlyDbError(e) };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export interface InstallResult {
  ok: boolean;
  bound: boolean;
  message: string;
}

// 执行安装：全新空库则建表+初始数据+创建管理员；检测到已有表（彩虹 DNS 现库）则直接绑定、补齐 sys_key，不破坏现有数据。
export async function performInstall(cfg: DbConfig, adminUsername: string, adminPassword: string): Promise<InstallResult> {
  const prefix = cfg.db_prefix || 'dnsmgr_';
  const test = await testConnection(cfg);
  if (!test.ok) return { ok: false, bound: false, message: test.message };

  const existed = test.initialized;
  if (!existed && (!adminUsername || !adminPassword)) {
    return { ok: false, bound: false, message: '全新安装需要设置管理员账号和密码' };
  }

  let conn: mysql.Connection;
  try {
    conn = await createConnection(cfg);
  } catch (e) {
    return { ok: false, bound: false, message: friendlyDbError(e) };
  }

  try {
    // 建表（IF NOT EXISTS：空库创建，现库跳过，均不删除已有数据）
    const statements = SCHEMA_SQL.split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await conn.query(stmt.replace(/dnsmgr_/g, prefix));
    }

    if (!existed) {
      // 全新安装：写入初始配置 + sys_key + 管理员
      const initConfigs: Array<[string, string]> = [
        ['version', '1.0.0'],
        ['notice_mail', '0'],
        ['notice_wxtpl', '0'],
        ['mail_smtp', 'smtp.qq.com'],
        ['mail_port', '465'],
      ];
      for (const [k, v] of initConfigs) {
        await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, [k, v]);
      }
      await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, ['sys_key', randomStr(16)]);

      const hash = bcrypt.hashSync(adminPassword, 10);
      await conn.query(
        `INSERT INTO \`${prefix}user\` (username, password, is_api, apikey, level, regtime, lasttime, status) VALUES (?, ?, 0, '', 2, NOW(), NOW(), 1)`,
        [adminUsername, hash]
      );
    } else {
      // 绑定现有库（彩虹 DNS 数据）：仅补齐 sys_key，不新增管理员、不覆盖数据
      const [rows] = await conn.query(`SELECT \`key\` FROM \`${prefix}config\` WHERE \`key\` = 'sys_key'`, []);
      if ((rows as any[]).length === 0) {
        await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, ['sys_key', randomStr(16)]);
      }
    }
  } catch (e: any) {
    return { ok: false, bound: false, message: '初始化失败：' + (e?.message || String(e)) };
  } finally {
    await conn.end().catch(() => undefined);
  }

  saveDbConfig(cfg);
  reinitPool(cfg);
  markInstalled();
  // 补齐 TS 版新增字段与表（email、注册验证码/注册码），幂等
  try {
    const { migrate } = await import('./migrate.js');
    await migrate();
  } catch {
    // 忽略：迁移会在下次启动时再次尝试
  }
  return {
    ok: true,
    bound: existed,
    message: existed ? '已绑定现有数据库，可直接用原管理员账号登录' : '安装完成',
  };
}

let installedFlag: boolean | null = null;

export function markInstalled(): void {
  installedFlag = true;
}

// 启动时/状态探测：当前配置下数据库是否已可正常使用（config 表存在即视为已安装）
export async function isInstalled(): Promise<boolean> {
  if (installedFlag !== null) return installedFlag;
  try {
    const one = await queryOne(`SELECT 1 FROM ${table('config')} LIMIT 1`);
    installedFlag = !!one;
  } catch {
    installedFlag = false;
  }
  return installedFlag;
}