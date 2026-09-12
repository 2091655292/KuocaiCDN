import { createHash } from 'node:crypto';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class WestDns implements DnsProvider {
  private username: string;
  private apiPassword: string;
  private error = '';
  private domain: string;
  private baseUrl = 'https://api.west.cn/api/v2';

  constructor(config: Record<string, any>) {
    this.username = config.username;
    this.apiPassword = config.api_password;
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async execute(params: Record<string, any>): Promise<any> {
    params.username = this.username;
    const time = String(Date.now());
    params.time = time;
    params.token = createHash('md5').update(this.username + this.apiPassword + time).digest('hex');
    try {
      const res = await fetch(this.baseUrl + '/domain/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buf);
      const arr = JSON.parse(text);
      if (arr.result == 200) return arr.data ?? [];
      this.error = arr.msg;
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.execute({ act: 'getdomains', page: PageNumber, limit: PageSize, domain: KeyWord ?? undefined });
    if (!data) return false;
    const list = (data.items || []).map((row: any) => ({ DomainId: row.domain, Domain: row.domain, RecordCount: 0 }));
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
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const host = SubDomain || KeyWord || undefined;
    const data = await this.execute({
      act: 'getdnsrecord',
      domain: this.domain,
      type: Type ?? undefined,
      line: Line ?? undefined,
      host,
      value: Value ?? undefined,
      pageno: PageNumber,
      limit: PageSize,
    });
    if (!data) return false;
    const list = (data.items || []).map((row: any) => ({
      RecordId: row.id,
      Domain: this.domain,
      Name: row.item,
      Type: row.type,
      Value: row.value,
      Line: row.line,
      TTL: row.ttl,
      MX: row.level ?? null,
      Status: row.pause == 1 ? '0' : '1',
      Weight: null,
      Remark: null,
      UpdateTime: null,
    }));
    return { total: data.total || 0, list };
  }

  async getDomainRecordInfo(_RecordId: string): Promise<RecordInfo | false> {
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const line = Line === 'default' ? '' : Line;
    const data = await this.execute({
      act: 'adddnsrecord',
      domain: this.domain,
      host: Name,
      type: Type,
      value: Value,
      level: Number(MX),
      ttl: Number(TTL),
      line,
    });
    return data && data.id ? String(data.id) : false;
  }

  async updateDomainRecord(RecordId: string, _Name: string, Type: string, Value: string, Line = '', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const line = Line === 'default' ? '' : Line;
    return (
      (await this.execute({
        act: 'moddnsrecord',
        domain: this.domain,
        id: RecordId,
        type: Type,
        value: Value,
        level: Number(MX),
        ttl: Number(TTL),
        line,
      })) !== false
    );
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.execute({ act: 'deldnsrecord', domain: this.domain, id: RecordId })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const data = await this.execute({ act: 'pause', domain: this.domain, id: RecordId, val: Status === '1' ? '0' : '1' });
    return data !== false;
  }

  async getRecordLine() {
    return {
      默认: '',
      电信: 'LTEL',
      联通: 'LCNC',
      移动: 'LMOB',
      教育网: 'LEDU',
      搜索引擎: 'LSEO',
      境外: 'LFOR',
    };
  }

  async addDomain(_Domain: string) {
    return false;
  }
}