import { promises as dns } from 'node:dns';

const dohServers = ['https://dns.alidns.com/resolve', 'https://doh.pub/resolve'];
const typeToRrtype: Record<string, number> = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, SOA: 6, NS: 2, PTR: 12, SRV: 33, CAA: 257 };

export async function getDnsRecords(domain: string, type: string): Promise<string[] | false> {
  try {
    if (type === 'A') return await dns.resolve4(domain);
    if (type === 'AAAA') return await dns.resolve6(domain);
    if (type === 'CNAME') return await dns.resolveCname(domain);
    if (type === 'MX') return (await dns.resolveMx(domain)).map((r) => r.exchange);
    if (type === 'TXT') return (await dns.resolveTxt(domain)).map((r) => r.join(''));
    return false;
  } catch {
    return false;
  }
}

export async function queryDnsDoh(domain: string, type: string): Promise<string[] | false> {
  const rrtype = typeToRrtype[type];
  if (!rrtype) return false;
  for (const server of dohServers) {
    try {
      const res = await fetch(`${server}?name=${encodeURIComponent(domain)}&type=${rrtype}`);
      if (!res.ok) continue;
      const arr = await res.json();
      const result: string[] = [];
      for (const row of arr.Answer || []) {
        let value = row.data;
        if (row.type === 5) value = String(value).replace(/\.$/, '');
        else if (row.type === 16) value = String(value).replace(/^"|"$/g, '');
        result.push(value);
      }
      if (result.length) return result;
    } catch {
      continue;
    }
  }
  return false;
}