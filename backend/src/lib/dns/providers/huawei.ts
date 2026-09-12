import { HuaweiCloud } from '../../clients/HuaweiCloud.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class HuaweiDns implements DnsProvider {
  private client: HuaweiCloud;
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    this.client = new HuaweiCloud(config.AccessKeyId, config.SecretAccessKey, 'dns.myhuaweicloud.com');
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
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

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const offset = (PageNumber - 1) * PageSize;
    const data = await this.send('GET', '/v2/zones', { offset, limit: PageSize, name: KeyWord ?? undefined });
    if (!data) return false;
    const list = (data.zones || []).map((row: any) => ({
      DomainId: row.id,
      Domain: (row.name || '').replace(/\.$/, ''),
      RecordCount: row.record_num,
    }));
    return { total: data.metadata?.total_count || 0, list };
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
    const offset = (PageNumber - 1) * PageSize;
    const query: Record<string, any> = {
      type: Type ?? undefined,
      line_id: Line ?? undefined,
      name: KeyWord ?? undefined,
      offset,
      limit: PageSize,
      records: Value ?? undefined,
    };
    if (Status) query.status = Status === '1' ? 'ACTIVE' : 'DISABLE';
    if (SubDomain) {
      query.name = this.getHost(SubDomain);
      query.search_mode = 'equal';
    }
    const data = await this.send('GET', '/v2.1/zones/' + this.domainid + '/recordsets', query);
    if (!data) return false;
    const list = (data.recordsets || []).map((row: any) => {
      let name = String(row.name || '').slice(0, -(String(row.zone_name || '').length + 1));
      if (name === '') name = '@';
      return {
        RecordId: row.id,
        Domain: (row.zone_name || '').replace(/\.$/, ''),
        Name: name,
        Type: row.type,
        Value: Array.isArray(row.records) ? row.records.join(',') : row.records,
        Line: row.line,
        TTL: row.ttl,
        MX: row.mx ?? null,
        Status: row.status === 'ACTIVE' ? '1' : '0',
        Weight: row.weight ?? null,
        Remark: row.description ?? null,
        UpdateTime: row.updated_at ?? null,
      };
    });
    return { total: data.metadata?.total_count || 0, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.send('GET', '/v2.1/zones/' + this.domainid + '/recordsets/' + RecordId);
    if (!data) return false;
    let name = String(data.name || '').slice(0, -(String(data.zone_name || '').length + 1));
    if (name === '') name = '@';
    return {
      RecordId: data.id,
      Domain: (data.zone_name || '').replace(/\.$/, ''),
      Name: name,
      Type: data.type,
      Value: Array.isArray(data.records) ? data.records.join(',') : data.records,
      Line: data.line,
      TTL: data.ttl,
      MX: data.mx ?? null,
      Status: data.status === 'ACTIVE' ? '1' : '0',
      Weight: data.weight ?? null,
      Remark: data.description ?? null,
      UpdateTime: data.updated_at ?? null,
    };
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'default_view', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const name = this.getHost(Name);
    let value = Value;
    if (Type === 'TXT' && !value.startsWith('"')) value = '"' + value + '"';
    const records = value.split(',').reverse();
    const params: Record<string, any> = { name, type: Type, records, line: Line, ttl: Number(TTL), description: Remark ?? undefined };
    if (Weight && Weight > 0) params.weight = Number(Weight);
    const data = await this.send('POST', '/v2.1/zones/' + this.domainid + '/recordsets', null, params);
    return data && data.id ? String(data.id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default_view', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const name = this.getHost(Name);
    let value = Value;
    if (Type === 'TXT' && !value.startsWith('"')) value = '"' + value + '"';
    const records = value.split(',').reverse();
    const params: Record<string, any> = { name, type: Type, records, line: Line, ttl: Number(TTL), description: Remark ?? undefined };
    if (Weight && Weight > 0) params.weight = Number(Weight);
    return (await this.send('PUT', '/v2.1/zones/' + this.domainid + '/recordsets/' + RecordId, null, params)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('DELETE', '/v2.1/zones/' + this.domainid + '/recordsets/' + RecordId)) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const params = { status: Status === '1' ? 'ENABLE' : 'DISABLE' };
    return (await this.send('PUT', '/v2.1/recordsets/' + RecordId + '/statuses/set', null, params)) !== false;
  }

  async getRecordLine() {
    return {
      default: 'default_view',
      Dianxin: 'Dianxin',
      Liantong: 'Liantong',
      Yidong: 'Yidong',
      Abroad: 'Abroad',
    };
  }

  async addDomain(Domain: string) {
    const data = await this.send('POST', '/v2/zones', null, { name: Domain });
    return data !== false;
  }

  private getHost(name: string): string {
    let host = name === '@' ? '' : name + '.';
    host += this.domain + '.';
    return host;
  }
}