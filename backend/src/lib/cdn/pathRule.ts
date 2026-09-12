// dnsmgr 的缓存规则格式为 {path, ttl}，各 CDN 平台需要把 path 归类到各自的规则类型。
// 分类语义：
// '*' 或空 → 全部文件（全局缓存）
// '.jpg'（点开头、无斜杠，可逗号/分号分隔多个）→ 文件后缀
// '/'、'/dir/'、'/dir/*' → 目录
// 其余（如 /index.html、/a*b.txt）→ 全路径（精确或通配）

export type PathRuleType = 'global' | 'file_extension' | 'catalog' | 'full_path';

export function normalizeValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function parsePathRule(path: string): { type: PathRuleType; value: string } {
  const p = normalizeValue(path);
  if (!p || p === '*') return { type: 'global', value: p };
  if (/^\.[^/]+$/.test(p)) return { type: 'file_extension', value: p };
  if (p === '/' || p.endsWith('/') || /\/\*$/.test(p)) return { type: 'catalog', value: p };
  return { type: 'full_path', value: p };
}

export function splitRuleValues(value: string): string[] {
  const v = normalizeValue(value);
  if (!v) return [];
  return v
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fileExtensions(value: string): string[] {
  const result: string[] = [];
  for (const item of splitRuleValues(value)) {
    const ext = normalizeValue(item).replace(/^\.+/, '');
    if (ext) result.push(ext);
  }
  return result;
}

export function catalogPath(value: string): string {
  let p = normalizeValue(value);
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+\*+$/, '');
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function wildcardToRegex(value: string): string {
  let regex = '^';
  for (const c of normalizeValue(value)) {
    if (c === '*') regex += '.*';
    else if (c === '?') regex += '.';
    else if ('\\.^$|()[]{}+*?'.includes(c)) regex += '\\' + c;
    else regex += c;
  }
  return regex + '$';
}
