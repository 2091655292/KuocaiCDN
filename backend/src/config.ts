import { query, table } from './db.js';

let cache: Record<string, string> = {};
let loadedAt = 0;

function isNullOrEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

export async function loadConfig(force = false): Promise<Record<string, string>> {
  if (!force && loadedAt && Date.now() - loadedAt < 60000) return cache;
  const all = await query<{ key: string; value: string }>(`SELECT \`key\`, value FROM ${table('config')}`);
  cache = {};
  for (const r of all) cache[r.key] = r.value;
  loadedAt = Date.now();
  return cache;
}

export async function configGet(key: string, def: string | null = null, force = false): Promise<string | null> {
  const cfg = force ? await loadConfig(true) : await loadConfig();
  const v = cfg[key];
  return isNullOrEmpty(v) ? def : v;
}

export async function configSet(key: string, value: string): Promise<void> {
  await query(`INSERT INTO ${table('config')} (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?`, [key, value, value]);
  cache[key] = value;
}

export async function getSysKey(): Promise<string> {
  const k = await configGet('sys_key', '');
  return k || 'dnsmgr-default-key';
}