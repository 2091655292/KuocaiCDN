import { isIP } from 'node:net';
import { query, queryOne, table } from '../db.js';
import { getDnsProvider } from './dns/factory.js';
import { getDnsRecords, queryDnsDoh } from './dnsQuery.js';
import type { DnsRecord } from './cert/types.js';

const lineDef: Record<string, string> = {
  aliyun: 'default', dnspod: '0', huawei: 'default_view', west: '', dnsla: '',
  huoshan: 'default', baidu: 'default', jdcloud: '-1', bt: '0', qingcloud: '0',
  cloudflare: '0', namesilo: 'default', henet: 'default', powerdns: 'default',
  spaceship: 'default', aliyunesa: '0', tencenteo: 'Default', dnsmgr: 'default', goedge: 'default',
};

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

type DnsList = Record<string, DnsRecord[]>;

async function getDnsModel(mainDomain: string): Promise<{ provider: any; type: string } | null> {
  let drow: any = await queryOne(
    `SELECT A.name, A.thirdid, A.aid, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`,
    [mainDomain],
  );
  if (!drow && /^xn--/.test(mainDomain)) {
    drow = await queryOne(
      `SELECT A.name, A.thirdid, A.aid, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`,
      [mainDomain],
    );
  }
  if (!drow) return null;
  const provider = getDnsProvider(drow.type, safeJson(drow.config), drow.name, drow.thirdid);
  if (!provider) return null;
  return { provider, type: drow.type };
}

function getHuaweiDnsRecords(list: DnsRecord[]): DnsRecord[] {
  const txtRecords: Record<string, string[]> = {};
  const rest: DnsRecord[] = [];
  for (const row of list) {
    if (row.type === 'TXT') {
      if (!txtRecords[row.name]) txtRecords[row.name] = [];
      txtRecords[row.name].push(row.value);
    } else {
      rest.push(row);
    }
  }
  for (const [name, rows] of Object.entries(txtRecords)) {
    rest.push({ name, type: 'TXT', value: '"' + rows.join('","') + '"' });
  }
  return rest;
}

export async function addDns(dnsList: DnsList, log: (txt: string) => void, cname = false): Promise<void> {
  const cnameDomainList: DnsList = {};
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    let drow = await queryOne(`SELECT A.*, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`, [mainDomain]);
    if (!drow && /^xn--/.test(mainDomain)) {
      drow = await queryOne(`SELECT A.*, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`, [mainDomain]);
    }
    if (!drow) {
      if (cname) {
        for (let i = list.length - 1; i >= 0; i--) {
          const row = list[i];
          const domain = row.name === '_acme-challenge' ? mainDomain : row.name.replace('_acme-challenge.', '') + '.' + mainDomain;
          const cnameRow = await queryOne(
            `SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.domain = ?`,
            [domain],
          );
          if (cnameRow) {
            row.name = cnameRow.rr;
            if (!cnameDomainList[cnameRow.cnamedomain]) cnameDomainList[cnameRow.cnamedomain] = [];
            cnameDomainList[cnameRow.cnamedomain].push(row);
            list.splice(i, 1);
          } else {
            throw new Error('域名' + domain + '未在本系统添加');
          }
        }
      } else {
        throw new Error('域名' + mainDomain + '未在本系统添加');
      }
    }
    if (!list.length) continue;

    const provider = getDnsProvider(drow.type, safeJson(drow.config), drow.name, drow.thirdid);
    if (!provider) throw new Error('DNS模块不存在');

    let records = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (drow.type === 'huawei') records = getHuaweiDnsRecords(records);

    const cache: Record<string, any> = {};
    for (const row of records) {
      const domain = row.name + '.' + mainDomain;
      if (!cache[row.name]) {
        cache[row.name] = await provider.getDomainRecords(1, 100, null, row.name, null, null, null);
      }
      if (!cache[row.name]) throw new Error('获取' + domain + '记录列表失败，' + provider.getError());

      const list2 = cache[row.name].list;
      const matched = list2.filter((v: any) => {
        const val = Array.isArray(v.Value) ? v.Value.join(',') : v.Value;
        return v.Type === row.type && (val === row.value || String(val).replace(/\.$/, '') === row.value);
      });
      if (matched.length) {
        cache[row.name].list = list2.filter((v: any) => !matched.includes(v));
        continue;
      }

      const sameType = list2.filter((v: any) => v.Type === row.type);
      for (const rec of sameType) {
        await provider.deleteDomainRecord(rec.RecordId);
        cache[row.name].list = cache[row.name].list.filter((v: any) => v.RecordId !== rec.RecordId);
        log('Delete DNS Record: ' + domain + ' ' + row.type);
      }

      const ttl = drow.type === 'namesilo' ? 3600 : 600;
      const line = lineDef[drow.type] ?? 'default';
      const res = await provider.addDomainRecord(row.name, row.type, row.value, line, ttl);
      if (!res && row.type !== 'CAA') throw new Error('添加' + domain + '解析记录失败，' + provider.getError());
      log('Add DNS Record: ' + domain + ' ' + row.type + ' ' + row.value);
    }
  }
  if (Object.keys(cnameDomainList).length) {
    await addDns(cnameDomainList, log);
  }
}

export async function delDns(dnsList: DnsList, log: (txt: string) => void, cname = false): Promise<void> {
  const cnameDomainList: DnsList = {};
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    let drow = await queryOne(`SELECT A.*, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`, [mainDomain]);
    if (!drow && /^xn--/.test(mainDomain)) {
      drow = await queryOne(`SELECT A.*, B.type, B.config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.name = ?`, [mainDomain]);
    }
    if (!drow) {
      if (cname) {
        for (let i = list.length - 1; i >= 0; i--) {
          const row = list[i];
          const domain = row.name === '_acme-challenge' ? mainDomain : row.name.replace('_acme-challenge.', '') + '.' + mainDomain;
          const cnameRow = await queryOne(
            `SELECT A.*, B.name AS cnamedomain FROM ${table('cert_cname')} A JOIN ${table('domain')} B ON A.did = B.id WHERE A.domain = ?`,
            [domain],
          );
          if (cnameRow) {
            row.name = cnameRow.rr;
            if (!cnameDomainList[cnameRow.cnamedomain]) cnameDomainList[cnameRow.cnamedomain] = [];
            cnameDomainList[cnameRow.cnamedomain].push(row);
            list.splice(i, 1);
          }
        }
      } else {
        continue;
      }
    }
    if (!list.length) continue;

    const provider = getDnsProvider(drow.type, safeJson(drow.config), drow.name, drow.thirdid);
    if (!provider) continue;

    let records = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (drow.type === 'huawei') records = getHuaweiDnsRecords(records);

    const cache: Record<string, any> = {};
    for (const row of records) {
      const domain = row.name + '.' + mainDomain;
      if (!cache[row.name]) {
        cache[row.name] = await provider.getDomainRecords(1, 100, null, row.name, null, null, null);
      }
      if (!cache[row.name]) continue;
      const matched = cache[row.name].list.filter((v: any) => {
        const val = Array.isArray(v.Value) ? v.Value.join(',') : v.Value;
        return v.Type === row.type && (val === row.value || String(val).replace(/\.$/, '') === row.value);
      });
      for (const rec of matched) {
        await provider.deleteDomainRecord(rec.RecordId);
        log('Delete DNS Record: ' + domain + ' ' + row.type + ' ' + row.value);
      }
    }
  }
  if (Object.keys(cnameDomainList).length) {
    await delDns(cnameDomainList, log);
  }
}

function valueMatches(expected: string, result: string[] | false): boolean {
  if (!result || !result.length) return false;
  if (result.includes(expected) || result.includes(expected.toLowerCase())) return true;
  if (isIP(expected)) {
    const normalized = result.map((v) => String(v).toLowerCase());
    return normalized.includes(expected.toLowerCase());
  }
  return false;
}

export async function verifyDns(dnsList: DnsList): Promise<boolean> {
  if (!Object.keys(dnsList).length) return true;
  for (const [mainDomain, list] of Object.entries(dnsList)) {
    for (const row of list) {
      if (row.type === 'CAA') continue;
      const domain = row.name + '.' + mainDomain;
      let result = await getDnsRecords(domain, row.type);
      if (!valueMatches(row.value, result)) {
        result = await queryDnsDoh(domain, row.type);
        if (!valueMatches(row.value, result)) return false;
      }
    }
  }
  return true;
}