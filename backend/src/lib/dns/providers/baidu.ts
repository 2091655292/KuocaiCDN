import { BaiduCloud } from '../../clients/BaiduCloud.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class BaiduDns implements DnsProvider {
  private client: BaiduCloud;
  private error = '';
  private domain: string;

  constructor(config: Record<string, any>) {
    this.client = new BaiduCloud(config.accessKeyId, config.secretAccessKey, 'dns.baidubce.com');
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private clientToken(): string {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  private async send(method: string, path: string, query?: Record<string, any> | null, params?: Record<string, any> | null): Promise<any> {
    try {
      return await this.client.request(method, path, query, params);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null): Promise<DomainListResult | false> {
    const data = await this.send('GET', '/v1/dns/zone', { name: KeyWord ?? undefined });
    if (!data) return false;
    const list = (data.zones || []).map((row: any) => ({
      DomainId: row.id,
      Domain: (row.name || '').replace(/\.$/, ''),
      RecordCount: 0,
    }));
    return { total: list.length, list };
  }

  async getDomainRecords(
    _PageNumber = 1,
    _PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
    _Line: string | null = null,
    Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const query: Record<string, any> = {};
    if (SubDomain) query.rr = SubDomain.toLowerCase();
    const data = await this.send('GET', '/v1/dns/zone/' + this.domain + '/record', query);
    if (!data) return false;
    let list = (data.records || []).map((row: any) => ({
      RecordId: row.id,
      Domain: this.domain,
      Name: row.rr,
      Type: row.type,
      Value: row.value,
      Line: row.line,
      TTL: row.ttl,
      MX: row.priority ?? null,
      Status: row.status === 'running' ? '1' : '0',
      Weight: null,
      Remark: row.description ?? null,
      UpdateTime: null,
    }));
    if (SubDomain) list = list.filter((v: any) => v.Name === SubDomain);
    else {
      if (KeyWord) list = list.filter((v: any) => (v.Name || '').includes(KeyWord) || (v.Value || '').includes(KeyWord));
      if (Value) list = list.filter((v: any) => v.Value === Value);
      if (Type) list = list.filter((v: any) => v.Type === Type);
      if (Status) list = list.filter((v: any) => v.Status === Status);
    }
    return { total: list.length, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.send('GET', '/v1/dns/zone/' + this.domain + '/record', { id: RecordId });
    if (!data || !data.records?.length) return false;
    const r = data.records[0];
    return {
      RecordId: r.id,
      Domain: this.domain,
      Name: r.rr,
      Type: r.type,
      Value: r.value,
      Line: r.line,
      TTL: r.ttl,
      MX: r.priority ?? null,
      Status: r.status === 'running' ? '1' : '0',
      Weight: null,
      Remark: r.description ?? null,
      UpdateTime: null,
    };
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const params: Record<string, any> = { rr: Name, type: Type, value: Value, line: Line, ttl: Number(TTL), description: Remark ?? undefined };
    if (Type === 'MX') params.priority = Number(MX);
    return (await this.send('POST', '/v1/dns/zone/' + this.domain + '/record', { clientToken: this.clientToken() }, params)) !== false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const params: Record<string, any> = { rr: Name, type: Type, value: Value, line: Line, ttl: Number(TTL), description: Remark ?? undefined };
    if (Type === 'MX') params.priority = Number(MX);
    return (await this.send('PUT', '/v1/dns/zone/' + this.domain + '/record/' + RecordId, { clientToken: this.clientToken() }, params)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('DELETE', '/v1/dns/zone/' + this.domain + '/record/' + RecordId, { clientToken: this.clientToken() })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const q: Record<string, any> = { clientToken: this.clientToken() };
    q[Status === '1' ? 'enable' : 'disable'] = '';
    return (await this.send('PUT', '/v1/dns/zone/' + this.domain + '/record/' + RecordId, q)) !== false;
  }

  async getRecordLine() {
    return {
      默认: 'default',
      电信: 'ct',
      联通: 'cnc',
      移动: 'cmnet',
      教育网: 'edu',
      搜索引擎: 'search',
    };
  }

  async addDomain(Domain: string) {
    return (await this.send('POST', '/v1/dns/zone', { clientToken: this.clientToken(), name: Domain })) !== false;
  }
}