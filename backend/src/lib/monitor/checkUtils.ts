import { execFile } from 'node:child_process';
import net from 'node:net';

export interface CheckResult {
  status: boolean;
  errmsg: string | null;
  usetime: number;
}

function isIp(s: string): boolean {
  return net.isIP(s) !== 0;
}

function isDomain(s: string): boolean {
  return /^[-a-z0-9_*.]{2,512}$/i.test(s) && s.includes('.');
}

export async function dnsResolve(host: string): Promise<string> {
  const { lookup } = await import('node:dns');
  try {
    const res = await lookup(host);
    return res.address;
  } catch {
    return '';
  }
}

export async function checkCurl(url: string, timeout: number, ip: string | null = null, _proxy = false): Promise<CheckResult> {
  const start = Date.now();
  let status = true;
  let errmsg: string | null = null;
  try {
    const u = new URL(url);
    if (!u.hostname) throw new Error('Invalid URL');
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout * 1000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' },
    });
    const httpcode = res.status;
    if (httpcode < 200 || httpcode >= 400) {
      status = false;
      errmsg = 'http_code=' + httpcode;
    }
    await res.arrayBuffer().catch(() => undefined);
  } catch (e: any) {
    status = false;
    errmsg = e && e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message || '请求失败');
  }
  const usetime = Math.round(Date.now() - start);
  return { status, errmsg, usetime };
}

export async function checkTcp(target: string, ip: string | null, port: number, timeout: number): Promise<CheckResult> {
  let host = target;
  if (ip && isIp(ip)) host = ip;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!isIp(host) && isDomain(host)) {
    host = await dnsResolve(host);
    if (!host) return { status: false, errmsg: 'DNS resolve failed', usetime: 0 };
  }
  if (!isIp(host)) return { status: false, errmsg: 'Invalid IP address', usetime: 0 };

  const start = Date.now();
  const status = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port, timeout: timeout * 1000 });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
  const usetime = Date.now() - start;
  return { status, errmsg: status ? null : '连接失败', usetime };
}

export async function checkPing(target: string, ip: string | null): Promise<CheckResult> {
  let host = target;
  if (ip && isIp(ip)) host = ip;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!isIp(host) && isDomain(host)) {
    host = await dnsResolve(host);
    if (!host) return { status: false, errmsg: 'DNS resolve failed', usetime: 0 };
  }
  if (!isIp(host)) return { status: false, errmsg: 'Invalid IP address', usetime: 0 };

  const isV6 = host.includes(':');
  const args = isV6 ? ['-6', '-c', '1', '-w', '1', host] : ['-c', '1', '-w', '1', host];
  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('ping', args, { timeout: 3000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const usetime = Math.round(Date.now() - start);
    return { status: true, errmsg: null, usetime };
  } catch {
    return { status: false, errmsg: 'ping timeout', usetime: 1000 };
  }
}