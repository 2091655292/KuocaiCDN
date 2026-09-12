import { query, queryOne, table } from '../../db.js';
import { configGet, configSet } from '../../config.js';
import { getDnsProvider } from '../dns/factory.js';
import { fmtDateTime } from '../util.js';

// 通用线路代码 -> 各 DNS 服务商线路值
const LINE_NAME: Record<string, Record<string, string>> = {
  aliyun: { DEF: 'default', CT: 'telecom', CU: 'unicom', CM: 'mobile', AB: 'oversea' },
  dnspod: { DEF: '0', CT: '10=0', CU: '10=1', CM: '10=3', AB: '3=0' },
  huawei: { DEF: 'default_view', CT: 'Dianxin', CU: 'Liantong', CM: 'Yidong', AB: 'Abroad' },
  west: { DEF: '', CT: 'LTEL', CU: 'LCNC', CM: 'LMOB', AB: 'LFOR' },
  dnsla: { DEF: '', CT: '84613316902921216', CU: '84613316923892736', CM: '84613316953252864', AB: '' },
  huoshan: { DEF: 'default', CT: 'telecom', CU: 'unicom', CM: 'mobile', AB: 'oversea' },
  baidu: { DEF: 'default', CT: 'ct', CU: 'cnc', CM: 'cmnet', AB: '' },
  jdcloud: { DEF: '-1', CT: '1', CU: '2', CM: '3', AB: '4' },
  bt: { DEF: '0', CT: '285344768', CU: '285345792', CM: '285346816' },
  qingcloud: { DEF: '0', CT: '2', CU: '3', CM: '4', AB: '8' },
  cloudflare: { DEF: '0' },
  namesilo: { DEF: 'default' },
  henet: { DEF: 'default' },
  powerdns: { DEF: 'default' },
  spaceship: { DEF: 'default' },
  aliyunesa: { DEF: '0' },
  tencenteo: { DEF: 'Default' },
  dnsmgr: { DEF: 'default' },
  goedge: { DEF: 'default' },
};

function safeJson(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

export async function getLicense(api: number, key: string): Promise<string> {
  if (api === 2) throw new Error('xingpingcn.top 接口免费使用，无需密钥，无积分限制');
  let url: string;
  if (api === 1) url = 'https://api.hostmonit.com/get_license?license=' + key;
  else url = 'https://www.wetest.vip/api/cf2dns/get_license?license=' + key;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!text) throw new Error('接口请求失败');
  let arr: any;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new Error('获取剩余请求次数失败');
  }
  if (arr.code === 200 && arr.count !== undefined) {
    return String(arr.count);
  }
  if (arr.info !== undefined) throw new Error('获取剩余请求次数失败，' + arr.info);
  throw new Error('获取剩余请求次数失败');
}

async function getIpAddressXingpingcn(ipType: string): Promise<Record<string, any>> {
  if (ipType === 'v6') throw new Error('xingpingcn.top 接口暂不支持IPv6');
  const proxy = (await configGet('optimize_ip_proxy', '')) || '';
  let url: string;
  if (proxy) {
    const p = proxy.trim();
    let valid = false;
    try {
      const u = new URL(p);
      valid = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      valid = false;
    }
    if (!valid) throw new Error('无效的代理地址配置：仅支持 http 和 https 协议');
    url = p.replace(/\/+$/, '') + '/xingpingcn/enhanced-FaaS-in-China/refs/heads/main/Cf.json';
  } else {
    url = 'https://raw.githubusercontent.com/xingpingcn/enhanced-FaaS-in-China/refs/heads/main/Cf.json';
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let arr: any;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new Error('获取优选IP数据失败，接口返回数据格式错误');
  }
  if (arr && arr.Cf && arr.Cf.result) {
    const result = arr.Cf.result;
    const info: Record<string, any> = {};
    if (Array.isArray(result.dianxin)) info.CT = result.dianxin.map((ip: string) => ({ ip }));
    if (Array.isArray(result.liantong)) info.CU = result.liantong.map((ip: string) => ({ ip }));
    if (Array.isArray(result.yidong)) info.CM = result.yidong.map((ip: string) => ({ ip }));
    return info;
  }
  throw new Error('获取优选IP数据失败，接口返回数据格式错误');
}

async function getIpAddress(cdnType: number, ipType: string): Promise<Record<string, any>> {
  const api = parseInt((await configGet('optimize_ip_api', '0')) || '0');
  if (api === 2) return await getIpAddressXingpingcn(ipType);

  let url: string;
  if (api === 1) {
    url = 'https://api.hostmonit.com/get_optimization_ip';
  } else {
    url = 'https://www.wetest.vip/api/cf2dns/';
    if (cdnType === 1) url += 'get_cloudflare_ip';
    else if (cdnType === 2) url += 'get_cloudfront_ip';
    else if (cdnType === 3) url += 'get_gcore_ip';
    else if (cdnType === 4) url += 'get_edgeone_ip';
  }
  const params = {
    key: await configGet('optimize_ip_key', 'o1zrmHAF'),
    type: ipType,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!text) throw new Error('接口请求失败');
  let arr: any;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new Error('获取优选IP数据失败');
  }
  if (arr.code === 200 && arr.info !== undefined) return arr.info;
  if (arr.info !== undefined) throw new Error('获取优选IP数据失败，' + arr.info);
  if (arr.msg !== undefined) throw new Error('获取优选IP数据失败，' + arr.msg);
  throw new Error('获取优选IP数据失败，原因未知');
}

const ipCache: Record<string, Record<string, any>> = {};

async function getIpAddress2(cdnType: number, ipType: string): Promise<Record<string, any>> {
  const key = cdnType + '_' + ipType;
  if (!ipCache[key]) {
    const info = await getIpAddress(cdnType, ipType);
    const res: Record<string, any> = {};
    if (info.DEF) res.DEF = info.DEF;
    if (info.CT) res.CT = info.CT;
    if (info.CU) res.CU = info.CU;
    if (info.CM) res.CM = info.CM;
    ipCache[key] = res;
  }
  return ipCache[key];
}

export async function executeAll(): Promise<boolean> {
  const minute = parseInt((await configGet('optimize_ip_min', '30')) || '30');
  const last = await configGet('optimize_ip_time', null, true);
  if (last) {
    const t = new Date(last.replace(/-/g, '/')).getTime();
    if (t > Date.now() - minute * 60 * 1000) return false;
  }
  const list = await query(`SELECT * FROM ${table('optimizeip')} WHERE active = 1`);
  if (list.length === 0) return false;
  console.log('开始执行IP优选任务，共获取到' + list.length + '个待执行任务');
  for (const row of list) {
    try {
      const result = await executeOne(row);
      await query(`UPDATE ${table('optimizeip')} SET status = 1, errmsg = NULL, updatetime = ? WHERE id = ?`, [fmtDateTime(), row.id]);
      console.log('优选任务' + row.id + '执行成功：' + result);
    } catch (e: any) {
      await query(`UPDATE ${table('optimizeip')} SET status = 2, errmsg = ?, updatetime = ? WHERE id = ?`, [e.message || String(e), fmtDateTime(), row.id]);
      console.log('优选任务' + row.id + '执行失败：' + e.message);
    }
  }
  await configSet('optimize_ip_time', fmtDateTime());
  return true;
}

export async function executeOne(row: any): Promise<string> {
  let addNum = 0;
  let changeNum = 0;
  let delNum = 0;

  const ipTypes = String(row.ip_type || '').split(',');
  for (const ipType of ipTypes) {
    if (!ipType) continue;

    const drow = await queryOne(
      `SELECT A.*, B.type AS account_type, B.config AS account_config FROM ${table('domain')} A JOIN ${table('account')} B ON A.aid = B.id WHERE A.id = ?`,
      [row.did]
    );
    if (!drow) throw new Error('域名不存在（ID：' + row.did + '）');
    if (!LINE_NAME[drow.account_type]) throw new Error('不支持的DNS服务商');

    const info = await getIpAddress2(row.cdn_type, ipType);

    const dns = getDnsProvider(drow.account_type, safeJson(drow.account_config), drow.name, drow.thirdid);
    if (!dns) throw new Error('DNS模块不存在');
    const domainRecords = await dns.getDomainRecords(1, 100, null, row.rr, null, null, null, null);
    if (domainRecords === false) throw new Error('获取记录列表失败，' + dns.getError());

    let type = row.type;
    if (type === 1 && (!info.DEF || info.DEF.length === 0)) {
      type = 0;
    }

    for (const line of Object.keys(info)) {
      const iplist = info[line];
      if (!iplist || iplist.length === 0) continue;
      let recordNum = row.recordnum;
      let getIps: string[] = iplist.map((x: any) => x.ip);
      if (drow.account_type === 'huawei') {
        getIps.sort();
        getIps = getIps.slice(0, row.recordnum);
        getIps = [getIps.join(',')];
        recordNum = 1;
      }
      let targetLine = line;
      if (type === 1 && line === 'CT') {
        targetLine = 'DEF';
      }
      const lineMap = LINE_NAME[drow.account_type];
      if (!lineMap[targetLine]) continue;
      const lineCode = lineMap[targetLine];
      const r = await processDnsLine(dns, row, domainRecords.list, recordNum, getIps, lineCode, ipType);
      addNum += r.add;
      changeNum += r.change;
      delNum += r.del;
    }
  }

  return '成功添加' + addNum + '条记录，修改' + changeNum + '条记录，删除' + delNum + '条记录';
}

async function processDnsLine(
  dns: any,
  row: any,
  recordList: any[],
  recordNum: number,
  getIps: string[],
  lineCode: string,
  ipType: string
): Promise<{ add: number; change: number; del: number }> {
  let add = 0;
  let change = 0;
  let del = 0;

  const records = recordList.filter((v) => v.Line === lineCode);

  // 删除 CNAME 记录
  const cnameRecords = records.filter((v) => v.Type === 'CNAME');
  for (const r of cnameRecords) {
    const res = await dns.deleteDomainRecord(r.RecordId);
    if (!res) throw new Error('删除解析失败，' + dns.getError());
    del++;
  }

  const targetType = ipType === 'v6' ? 'AAAA' : 'A';
  const ipRecords = records.filter((v) => v.Type === targetType).map((v) => ({ ...v, Value: String(v.Value) }));

  const existIps = ipRecords.map((v) => v.Value);
  const getIpSet = new Set(getIps);
  const existIpSet = new Set(existIps);
  const addIps = getIps.filter((ip) => !existIpSet.has(ip));
  const delIps = existIps.filter((ip) => !getIpSet.has(ip));

  let correctCount = existIps.filter((ip) => !delIps.includes(ip)).length;

  if (delIps.length > 0) {
    for (const record of ipRecords) {
      if (delIps.includes(record.Value)) {
        const addIp = addIps.pop();
        if (addIp) {
          const res = await dns.updateDomainRecord(record.RecordId, row.rr, targetType, addIp, lineCode, row.ttl);
          if (!res) throw new Error('修改解析失败，' + dns.getError());
          change++;
          correctCount++;
        } else {
          const res = await dns.deleteDomainRecord(record.RecordId);
          if (!res) throw new Error('删除解析失败，' + dns.getError());
          del++;
        }
      }
    }
  }

  if (correctCount < recordNum && addIps.length > 0) {
    for (const addIp of addIps) {
      const res = await dns.addDomainRecord(row.rr, targetType, addIp, lineCode, row.ttl);
      if (!res) throw new Error('添加解析失败，' + dns.getError());
      add++;
      correctCount++;
      if (correctCount >= recordNum) break;
    }
  }

  return { add, change, del };
}