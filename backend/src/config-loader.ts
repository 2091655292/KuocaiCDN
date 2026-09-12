import fs from 'node:fs';
import path from 'node:path';

export interface DbConfig {
  db_host: string;
  db_port: number;
  db_user: string;
  db_password: string;
  db_name: string;
  db_prefix: string;
}

function resolveConfPath(): string {
  if (process.env.DNSMGR_CONF) return process.env.DNSMGR_CONF;
  if (process.env.DNSMGR_DATA_DIR) return path.join(process.env.DNSMGR_DATA_DIR, 'config.json');
  return path.join(process.cwd(), 'data', 'config.json');
}

const CONF_PATH = resolveConfPath();

export function confPath(): string {
  return CONF_PATH;
}

// 读取数据库配置：持久化配置文件优先，其次环境变量，最后默认值。
// 安装向导写入的配置会持久化到 CONF_PATH，重启后仍生效，从而实现“绑定彩虹 DNS 现库”无需重复配置。
export function loadDbConfig(): DbConfig {
  const cfg: DbConfig = {
    db_host: process.env.DB_HOST || '127.0.0.1',
    db_port: Number(process.env.DB_PORT || 3306),
    db_user: process.env.DB_USER || 'dnsmgr',
    db_password: process.env.DB_PASSWORD || 'dnsmgr123456',
    db_name: process.env.DB_NAME || 'dnsmgr',
    db_prefix: process.env.DB_PREFIX || 'dnsmgr_',
  };
  try {
    const raw = fs.readFileSync(CONF_PATH, 'utf8');
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      if (saved.db_host) cfg.db_host = saved.db_host;
      if (saved.db_port) cfg.db_port = Number(saved.db_port);
      if (saved.db_user) cfg.db_user = saved.db_user;
      if (saved.db_password) cfg.db_password = saved.db_password;
      if (saved.db_name) cfg.db_name = saved.db_name;
      if (saved.db_prefix) cfg.db_prefix = saved.db_prefix;
    }
  } catch {
    // 无配置文件，使用环境变量/默认值
  }
  return cfg;
}

export function saveDbConfig(cfg: DbConfig): void {
  fs.mkdirSync(path.dirname(CONF_PATH), { recursive: true });
  fs.writeFileSync(CONF_PATH, JSON.stringify(cfg, null, 2));
}

export function hasDbConfigFile(): boolean {
  try {
    return fs.existsSync(CONF_PATH);
  } catch {
    return false;
  }
}