import { createHmac } from 'node:crypto';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

function formatTime(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class BtDns implements DnsProvider {
  private accountId: string;
  private accessKey: string;
  private secretKey: string;
  private baseUrl = 'https://dmp.bt.cn';
  private error = '';
  private domain: string;
  private domainid: number | null = null;
  private domainType: number = 1;

  constructor(config: Record<string, any>) {
    this.accountId = config.AccountID || '';
    this.accessKey = config.AccessKey || '';
    this.secretKey = config.SecretKey || '';
    this.domain = config.domain || '';
    if (config.domainid) {
      const a = String(config.domainid).split('|');
      this.domainid = parseInt(a[0], 10);
      this.domainType = a.length > 1 ? parseInt(a[1], 10) : 1;
    }
  }

  getError() {
    return this.error;
  }

  private async execute(path: string, params: Record<string, any>): Promise<any> {
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify(params ?? {});
      const signingString = [this.accountId, timestamp, 'POST', path, body].join('\n');
      const signature = createHmac('sha256', this.secretKey).update(signingString).digest('hex');
      const res = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Account-ID': this.accountId,
          'X-Access-Key': this.accessKey,
          'X-Timestamp': timestamp,
          'X-Signature': signature,
        },
        body,
      });
      const text = await res.text();
      let arr: any;
      try {
        arr = JSON.parse(text);
      } catch {
        this.error = '返回数据解析失败';
        return false;
      }
      if (arr && arr.code === 0) return arr.data;
      this.error = arr?.msg || '返回数据解析失败';
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.execute('/api/v1/dns/manage/list_domains', { p: PageNumber, rows: PageSize, keyword: KeyWord ?? '' });
    if (!data) return false;
    const list = (data.data || []).map((row: any) => ({
      DomainId: row.local_id + '|' + row.domain_type,
      Domain: row.full_domain,
      RecordCount: row.record_count,
    }));
    return { total: data.total || 0, list };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    Line: string | null = null,
    Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const param: Record<string, any> = { domain_id: this.domainid, domain_type: this.domainType, p: PageNumber, rows: PageSize };
    if (SubDomain) {
      param.searchKey = 'record';
      param.searchValue = SubDomain;
    } else if (KeyWord) {
      param.searchKey = 'record';
      param.searchValue = KeyWord;
    } else if (Value) {
      param.searchKey = 'value';
      param.searchValue = Value;
    } else if (Type) {
      param.searchKey = 'type';
      param.searchValue = Type;
    } else if (Status) {
      param.searchKey = 'state';
      param.searchValue = Status === '0' ? '1' : '0';
    } else if (Line) {
      param.searchKey = 'line';
      param.searchValue = Line;
    }
    const data = await this.execute('/api/v1/dns/record/list', param);
    if (!data) return false;
    const list: RecordInfo[] = (data.data || []).map((row: any) => ({
      RecordId: String(row.record_id),
      Domain: this.domain,
      Name: row.record,
      Type: row.type,
      Value: row.value,
      Line: row.viewID,
      TTL: row.TTL,
      MX: row.MX,
      Status: row.state === 1 ? '0' : '1',
      Weight: row.MX,
      Remark: row.remark ?? null,
      UpdateTime: formatTime(row.created_at),
    }));
    return { total: data.count || 0, list };
  }

  async getDomainRecordInfo(_RecordId: string) {
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const w = Weight && Number(Weight) > 0 ? Number(Weight) : 1;
    const param: Record<string, any> = {
      domain_id: this.domainid,
      domain_type: this.domainType,
      type: Type,
      record: Name,
      value: Value,
      ttl: Number(TTL),
      view_id: Number(Line),
      remark: Remark ?? '',
      mx: Type === 'MX' ? Number(MX) : w,
    };
    return (await this.execute('/api/v1/dns/record/create', param)) !== false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const w = Weight && Number(Weight) > 0 ? Number(Weight) : 1;
    const param: Record<string, any> = {
      record_id: RecordId,
      domain_id: this.domainid,
      domain_type: this.domainType,
      type: Type,
      record: Name,
      value: Value,
      ttl: Number(TTL),
      view_id: Number(Line),
      remark: Remark ?? '',
      mx: Type === 'MX' ? Number(MX) : w,
    };
    return (await this.execute('/api/v1/dns/record/update', param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.execute('/api/v1/dns/record/delete', { id: RecordId, domain_id: this.domainid, domain_type: this.domainType })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const path = Status === '0' ? '/api/v1/dns/record/pause' : '/api/v1/dns/record/start';
    return (await this.execute(path, { record_id: RecordId, domain_id: this.domainid, domain_type: this.domainType })) !== false;
  }

  async getRecordLine(): Promise<Record<string, string> | false> {
    const data = await this.execute('/api/v1/dns/record/get_views', {});
    if (!data) return false;
    const list: Record<string, string> = {};
    const walk = (lineList: any[]) => {
      for (const row of lineList) {
        if (row.free && list[row.name] === undefined) {
          list[row.name] = String(row.viewId);
          if (row.children?.length) walk(row.children);
        }
      }
    };
    walk(data || []);
    return list;
  }

  async addDomain(Domain: string) {
    const data = await this.execute('/api/v1/dns/manage/add_external_domain', { full_domain: Domain });
    return data !== false;
  }
}