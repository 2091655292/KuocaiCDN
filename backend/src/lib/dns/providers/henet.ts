import { createHash } from 'node:crypto';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

const sessionCache = new Map<string, { cookie: string; expire: number }>();
const SESSION_TTL = 12 * 3600 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

export class HenetDns implements DnsProvider {
  private username: string;
  private password: string;
  private baseUrl = 'https://dns.he.net/';
  private error = '';
  private domain: string;
  private domainid: string;
  private cookie = '';
  private loggedIn = false;
  private cacheKey: string;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.password = config.password || '';
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
    this.cacheKey = 'henet_cookie_' + createHash('md5').update(this.username + '|' + this.password).digest('hex');
    this.loadCachedSession();
  }

  getError() {
    return this.error;
  }

  private loadCachedSession() {
    const cached = sessionCache.get(this.cacheKey);
    if (cached && cached.expire > Date.now()) {
      this.cookie = cached.cookie;
      this.loggedIn = true;
    }
  }

  private saveCachedSession() {
    if (this.cookie !== '') {
      sessionCache.set(this.cacheKey, { cookie: this.cookie, expire: Date.now() + SESSION_TTL });
    }
  }

  private clearCachedSession() {
    sessionCache.delete(this.cacheKey);
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, any> | null = null, requireLogin = true, allowRelogin = true): Promise<string | false> {
    if (requireLogin && !this.loggedIn && (await this.login()) === false) {
      return false;
    }
    const headers: Record<string, string> = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let body: string | undefined;
    const init: RequestInit = { method, headers, redirect: 'manual' };
    if (method === 'POST' && params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) qs.append(k, String(v));
      }
      body = qs.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = body;
    }
    try {
      const res = await fetch(this.baseUrl + path, init);
      const setCookies = (res.headers as any).getSetCookie?.() ?? [];
      if (setCookies.length) {
        const cookies: Record<string, string> = {};
        if (this.cookie !== '') {
          for (const pair of this.cookie.split('; ')) {
            const idx = pair.indexOf('=');
            if (idx > 0) cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
          }
        }
        for (const sc of setCookies) {
          const first = sc.split(';')[0];
          const idx = first.indexOf('=');
          if (idx > 0) cookies[first.slice(0, idx)] = first.slice(idx + 1);
        }
        this.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        if (this.loggedIn) this.saveCachedSession();
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const loc = res.headers.get('location')!;
        const url = new URL(loc, this.baseUrl);
        if (url.hostname === 'dns.he.net') {
          return this.request('GET', url.pathname + url.search, null, false, allowRelogin);
        }
      }
      if (res.status >= 400) {
        this.error = 'HTTP请求失败：' + res.status;
        return false;
      }
      const html = await res.text();
      if (requireLogin && allowRelogin && this.isLoginExpired(html)) {
        this.clearCachedSession();
        this.cookie = '';
        this.loggedIn = false;
        if ((await this.login()) === false) return false;
        return this.request(method, path, params, true, false);
      }
      return html;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  private async login(): Promise<string | false> {
    if (this.loggedIn) {
      return this.request('GET', '');
    }
    await this.request('GET', '', null, false);
    const html = await this.request('POST', '', { email: this.username, pass: this.password }, false);
    if (html === false) return false;
    if (/incorrect|Invalid/i.test(html)) {
      this.error = this.extractMessage(html) || '登录失败，请检查用户名和密码';
      return false;
    }
    const domains = this.parseDomains(html);
    if (domains.length === 0 && !html.includes('hosted_dns_zoneid')) {
      this.error = this.extractMessage(html) || '登录失败，未找到域名列表';
      return false;
    }
    this.loggedIn = true;
    this.saveCachedSession();
    return html;
  }

  private isLoginExpired(html: string | false): boolean {
    if (!html) return false;
    return html.includes('name="email"') && html.includes('name="pass"') && !html.includes('hosted_dns_zoneid');
  }

  private parseDomains(html: string): any[] {
    const map = new Map<string, any>();
    const patterns = [
      /onclick="delete_dom\(this\);"[^>]*name="([^"]+)"[^>]*value="(\d+)"/gi,
      /name="([^"]+)"[^>]*value="(\d+)"[^>]*onclick="delete_dom\(this\);"/gi,
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        map.set(match[2], { DomainId: match[2], Domain: decodeEntities(match[1]), RecordCount: 0 });
      }
    }
    for (const match of html.matchAll(/hosted_dns_zoneid=(\d+)[^"']*["'][^>]*>\s*([^<]+)\s*</gi)) {
      const domain = decodeEntities(match[2]).trim();
      if (domain !== '' && !map.has(match[1])) {
        map.set(match[1], { DomainId: match[1], Domain: domain, RecordCount: 0 });
      }
    }
    return [...map.values()];
  }

  private extractCells(rowHtml: string): string[] {
    const cells: string[] = [];
    for (const match of rowHtml.matchAll(/<td[^>]*>(.*?)<\/td>/gis)) {
      let cell = match[1]
        .replace(/<script\b[^>]*>.*?<\/script>/gis, '')
        .replace(/<style\b[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]+>/g, '');
      cell = decodeEntities(cell).replace(/\s+/g, ' ').trim();
      if (cell !== '') cells.push(cell);
    }
    return cells;
  }

  private parseRecords(html: string): RecordInfo[] {
    const list: RecordInfo[] = [];
    const rows = html.matchAll(/<tr class="dns_tr" [^>]*>.*?<\/tr>/gis);
    for (const row of rows) {
      const cells = this.extractCells(row[0]);
      if (cells.length < 4) continue;
      const ttl = /^\d+$/.test(cells[4]) ? parseInt(cells[4], 10) : 0;
      const name = cells[2];
      const type = cells[3].toUpperCase();
      const value = cells[6] ?? '';
      const priority = /^\d+$/.test(cells[5]) ? parseInt(cells[5], 10) : null;
      list.push({
        RecordId: cells[1],
        Domain: this.domain,
        Name: this.fromFullName(name),
        Type: type,
        Value: value.replace(/^"|"$/g, '').trim(),
        Line: 'default',
        TTL: ttl,
        MX: priority,
        Status: row[0].toLowerCase().includes('disabled') ? '0' : '1',
        Weight: null,
        Remark: null,
        UpdateTime: null,
      });
    }
    return list;
  }

  private toFullName(name: string): string {
    if (name === '@' || name === '') return this.domain;
    if (name.endsWith('.' + this.domain) || name.toLowerCase() === this.domain.toLowerCase()) return name;
    return name + '.' + this.domain;
  }

  private fromFullName(name: string): string {
    name = name.replace(/\.+$/, '');
    if (name.toLowerCase() === this.domain.toLowerCase()) return '@';
    if (name.toLowerCase().endsWith('.' + this.domain.toLowerCase())) {
      return name.slice(0, -(this.domain.length + 1));
    }
    return name;
  }

  private convertValue(value: string, type: string): string {
    if (type.toUpperCase() === 'TXT') return value.replace(/^"+|"+$/g, '');
    return value;
  }

  private extractMessage(html: string | false): string | null {
    if (!html) return null;
    const m1 = html.match(/<(?:div|span)[^>]*class="[^"]*(?:error|warn|success|message)[^"]*"[^>]*>(.*?)<\/(?:div|span)>/is);
    if (m1) return decodeEntities(m1[1].replace(/<[^>]+>/g, '')).trim();
    const m2 = html.match(/(Successfully [^<]+|Error:[^<]+|Invalid [^<]+)/i);
    if (m2) return decodeEntities(m2[1]).trim();
    return null;
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const html = await this.login();
    if (html === false) return false;
    let list = this.parseDomains(html);
    if (KeyWord) {
      list = list.filter((row) => row.Domain.toLowerCase().includes(KeyWord.toLowerCase()));
    }
    const total = list.length;
    const offset = Math.max(0, (PageNumber - 1) * PageSize);
    return { total, list: list.slice(offset, offset + PageSize) };
  }

  private async getZoneId(): Promise<string | false> {
    if (this.domainid) return this.domainid;
    if (!this.domain) {
      this.error = '未指定域名';
      return false;
    }
    const domains = await this.getDomainList(this.domain, 1, 1000);
    if (domains === false) return false;
    for (const row of domains.list) {
      if (row.Domain.toLowerCase() === this.domain.toLowerCase()) {
        this.domainid = row.DomainId;
        return this.domainid;
      }
    }
    this.error = '域名不存在或无权限访问';
    return false;
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    _Line: string | null = null,
    Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const zoneid = await this.getZoneId();
    if (zoneid === false) return false;
    const qs = new URLSearchParams({ hosted_dns_zoneid: zoneid, menu: 'edit_zone', hosted_dns_editzone: '' });
    const html = await this.request('GET', 'index.cgi?' + qs.toString());
    if (html === false) return false;
    let list = this.parseRecords(html);
    if (SubDomain) {
      list = list.filter((row) => row.Name.toLowerCase() === SubDomain.toLowerCase());
    } else {
      if (KeyWord) {
        list = list.filter((row) => row.Name.toLowerCase().includes(KeyWord.toLowerCase()) || row.Value.toLowerCase().includes(KeyWord.toLowerCase()));
      }
      if (Value) list = list.filter((row) => row.Value === Value);
      if (Type) list = list.filter((row) => row.Type.toUpperCase() === Type.toUpperCase());
      if (Status) list = list.filter((row) => row.Status === Status);
    }
    const total = list.length;
    const offset = Math.max(0, (PageNumber - 1) * PageSize);
    return { total, list: list.slice(offset, offset + PageSize) };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const records = await this.getDomainRecords(1, 1000);
    if (records === false) return false;
    for (const row of records.list) {
      if (row.RecordId === RecordId) return row;
    }
    this.error = '解析记录不存在';
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const zoneid = await this.getZoneId();
    if (zoneid === false) return false;
    const params: Record<string, any> = {
      account: '',
      menu: 'edit_zone',
      Type: Type.toUpperCase(),
      hosted_dns_zoneid: zoneid,
      hosted_dns_recordid: '',
      hosted_dns_editzone: '1',
      Priority: Type.toUpperCase() === 'MX' ? Number(MX) : '',
      Name: this.toFullName(Name),
      Content: this.convertValue(Value, Type),
      TTL: Number(TTL),
      hosted_dns_editrecord: 'Submit',
    };
    const html = await this.request('POST', 'index.cgi', params);
    if (html !== false && html.includes('Successfully added new record')) {
      const name = this.fromFullName(this.toFullName(Name));
      const value = this.convertValue(Value, Type);
      for (const record of this.parseRecords(html)) {
        if (record.Name.toLowerCase() === name.toLowerCase() && record.Type === Type.toUpperCase() && record.Value === value) {
          return record.RecordId;
        }
      }
      return true;
    }
    this.error = this.extractMessage(html) || '添加解析记录失败';
    return false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const zoneid = await this.getZoneId();
    if (zoneid === false) return false;
    const params: Record<string, any> = {
      account: '',
      menu: 'edit_zone',
      Type: Type.toUpperCase(),
      hosted_dns_zoneid: zoneid,
      hosted_dns_recordid: RecordId,
      hosted_dns_editzone: '1',
      Priority: Type.toUpperCase() === 'MX' ? Number(MX) : '',
      Name: this.toFullName(Name),
      Content: this.convertValue(Value, Type),
      TTL: Number(TTL),
      hosted_dns_editrecord: 'Update',
    };
    const html = await this.request('POST', 'index.cgi', params);
    if (html !== false && html.includes('Successfully updated record')) {
      return true;
    }
    this.error = this.extractMessage(html) || '修改解析记录失败';
    return false;
  }

  async deleteDomainRecord(RecordId: string) {
    const zoneid = await this.getZoneId();
    if (zoneid === false) return false;
    const html = await this.request('POST', 'index.cgi', {
      menu: 'edit_zone',
      hosted_dns_zoneid: zoneid,
      hosted_dns_recordid: RecordId,
      hosted_dns_editzone: '1',
      hosted_dns_delrecord: '1',
      hosted_dns_delconfirm: 'delete',
    });
    if (html !== false && html.includes('Successfully removed record')) {
      return true;
    }
    this.error = this.extractMessage(html) || '删除解析记录失败';
    return false;
  }

  async setDomainRecordStatus(_RecordId: string, _Status: string) {
    return false;
  }

  async getRecordLine() {
    return { 默认: 'default' };
  }

  async addDomain(_Domain: string) {
    return false;
  }
}