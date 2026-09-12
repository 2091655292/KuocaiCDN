import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class NamesiloDns implements DnsProvider {
  private apikey: string;
  private baseUrl = 'https://www.namesilo.com/api/';
  private version = '1';
  private error = '';
  private domain: string;

  constructor(config: Record<string, any>) {
    this.apikey = config.apikey || '';
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async sendRequest(operation: string, param: Record<string, any> | null = null): Promise<any> {
    try {
      const params: Record<string, string> = {
        version: this.version,
        type: 'json',
        key: this.apikey,
        ...(param || {}),
      };
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) qs.append(k, String(v));
      }
      const res = await fetch(this.baseUrl + operation + '?' + qs.toString());
      const text = await res.text();
      let arr: any;
      try {
        arr = JSON.parse(text);
      } catch {
        this.error = text;
        return false;
      }
      if (arr?.reply?.code) {
        if (String(arr.reply.code) === '300') {
          return arr.reply;
        }
        this.error = arr.reply.detail || '未知错误';
        return false;
      }
      this.error = text;
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
    const data = await this.sendRequest('listDomains', { page: PageNumber, pageSize: PageSize });
    if (!data) return false;
    const list = (data.domains || []).map((row: any) => ({
      DomainId: row.domain,
      Domain: row.domain,
      RecordCount: 0,
    }));
    return { total: data.pager?.total || 0, list };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
  ): Promise<RecordListResult | false> {
    const data = await this.sendRequest('dnsListRecords', { domain: this.domain });
    if (!data) return false;
    let list: RecordInfo[] = (data.resource_record || []).map((row: any) => ({
      RecordId: String(row.record_id),
      Domain: this.domain,
      Name: row.host,
      Type: row.type,
      Value: row.value,
      Line: 'default',
      TTL: row.ttl,
      MX: row.distance ?? null,
      Status: '1',
      Weight: null,
      Remark: null,
      UpdateTime: null,
    }));
    if (SubDomain) {
      list = list.filter((v) => v.Name.toLowerCase() === SubDomain.toLowerCase());
    } else {
      if (KeyWord) {
        list = list.filter((v) => v.Name.includes(KeyWord) || v.Value.includes(KeyWord));
      }
      if (Value) {
        list = list.filter((v) => v.Value === Value);
      }
      if (Type) {
        list = list.filter((v) => v.Type === Type);
      }
    }
    void PageNumber;
    void PageSize;
    return { total: (data.resource_record || []).length, list };
  }

  async getDomainRecordInfo(_RecordId: string) {
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const host = Name === '@' ? '' : Name;
    const param: Record<string, any> = { domain: this.domain, rrtype: Type, rrhost: host, rrvalue: Value, rrttl: TTL };
    if (Type === 'MX') param.rrdistance = Number(MX);
    const data = await this.sendRequest('dnsAddRecord', param);
    return data && data.record_id ? String(data.record_id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, _Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    const host = Name === '@' ? '' : Name;
    const param: Record<string, any> = { domain: this.domain, rrid: RecordId, rrtype: Type, rrhost: host, rrvalue: Value, rrttl: TTL };
    if (Type === 'MX') param.rrdistance = Number(MX);
    return (await this.sendRequest('dnsUpdateRecord', param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.sendRequest('dnsDeleteRecord', { domain: this.domain, rrid: RecordId })) !== false;
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