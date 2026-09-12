import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, table } from '../../db.js';

let domainsCache: string[] | null = null;

export async function getMainDomain(host: string): Promise<string> {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return host;
  if (!domainsCache) {
    const rows = await query<{ name: string }>(`SELECT name FROM ${table('domain')}`);
    const aliasRows = await query<{ name: string }>(`SELECT name FROM ${table('domain_alias')}`);
    domainsCache = [...rows.map((r) => r.name), ...aliasRows.map((r) => r.name)].sort((a, b) => b.length - a.length);
  }
  for (const domain of domainsCache) {
    if (host === domain || host.endsWith('.' + domain)) return domain;
  }
  return host;
}

function extractCN(subject: string): string {
  const m = subject.match(/(?:^|,\s*)CN\s*=\s*([^,]+)/i);
  return m ? m[1].trim() : '';
}

export function parseCertPem(pem: string): { issuer: string; subject: string; validFrom: number; validTo: number } {
  const x = new X509Certificate(pem);
  return {
    issuer: extractCN(x.issuer),
    subject: extractCN(x.subject),
    validFrom: new Date(x.validFrom).getTime() / 1000,
    validTo: new Date(x.validTo).getTime() / 1000,
  };
}

export function unzip(zipPath: string, destDir: string): void {
  execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' });
}

export function buildPfx(fullchain: string, privatekey: string, pwd = '123456'): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'pfx_'));
  const certFile = join(dir, 'fullchain.pem');
  const keyFile = join(dir, 'key.pem');
  const pfxFile = join(dir, 'out.pfx');
  try {
    writeFileSync(certFile, fullchain);
    writeFileSync(keyFile, privatekey);
    execFileSync('openssl', ['pkcs12', '-export', '-out', pfxFile, '-inkey', keyFile, '-in', certFile, '-passout', `pass:${pwd}`]);
    return readFileSync(pfxFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function findFileByExt(dir: string, exts: string[]): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = findFileByExt(p, exts);
      if (r) return r;
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      return p;
    }
  }
  return null;
}