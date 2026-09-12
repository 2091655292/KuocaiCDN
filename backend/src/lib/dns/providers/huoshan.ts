import { Volcengine } from '../../clients/Volcengine.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class HuoshanDns implements DnsProvider {
  private client: Volcengine;
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    this.client = new Volcengine(config.AccessKeyId, config.SecretAccessKey, 'open.volcengineapi.com', 'DNS', '2018-08-01', 'cn-north-1');
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private async send(method: string, action: string, params: Record<string, any> = {}): Promise<any> {
    try {
      return await this.client.request(method, action, params);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.send('GET', 'ListZones', { PageNumber, PageSize, Key: KeyWord ?? undefined });
    if (!data) return false;
    const list = (data.Zones || []).map((row: any) => ({
      DomainId: row.ZID,
      Domain: row.ZoneName,
      RecordCount: row.RecordCount,
    }));
    return { total: data.Total || 0, list };
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
    const query: Record<string, any> = { ZID: Number(this.domainid), PageNumber, PageSize, SearchOrder: 'desc' };
    if (SubDomain || Type || Line || Value) {
      Object.assign(query, { Host: SubDomain ?? undefined, Value: Value ?? undefined, Type: Type ?? undefined, Line: Line ?? undefined, SearchMode: 'exact' });
    } else if (KeyWord) {
      query.Host = KeyWord;
    }
    const data = await this.send('GET', 'ListRecords', query);
    if (!data) return false;
    const list = (data.Records || []).map((row: any) => {
      let value = row.Value;
      let mx: number | null = null;
      if (row.Type === 'MX' && typeof value === 'string') {
        const idx = value.indexOf(' ');
        if (idx >= 0) {
          mx = Number(value.slice(0, idx));
          value = value.slice(idx + 1);
        }
      }
      return {
        RecordId: row.RecordID,
        Domain: this.domain,
        Name: row.Host,
        Type: row.Type,
        Value: value,
        Line: row.Line,
        TTL: row.TTL,
        MX: mx,
        Status: row.Enable ? '1' : '0',
        Weight: row.Weight ?? null,
        Remark: row.Remark ?? null,
        UpdateTime: row.UpdatedAt ?? null,
      };
    });
    return { total: data.TotalCount || 0, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.send('GET', 'QueryRecord', { RecordID: RecordId });
    if (!data) return false;
    let value = data.Value;
    let mx: number | null = null;
    if (data.Type === 'MX' && typeof value === 'string') {
      const idx = value.indexOf(' ');
      if (idx >= 0) {
        mx = Number(value.slice(0, idx));
        value = value.slice(idx + 1);
      }
    }
    return {
      RecordId: data.RecordID,
      Domain: this.domain,
      Name: data.Host,
      Type: data.Type,
      Value: value,
      Line: data.Line,
      TTL: data.TTL,
      MX: mx,
      Status: data.Enable ? '1' : '0',
      Weight: data.Weight ?? null,
      Remark: data.Remark ?? null,
      UpdateTime: data.UpdatedAt ?? null,
    };
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const value = Type === 'MX' ? `${Number(MX)} ${Value}` : Value;
    const params: Record<string, any> = { ZID: Number(this.domainid), Host: Name, Type, Value: value, Line, TTL: Number(TTL), Remark: Remark ?? undefined };
    if (Weight && Weight > 0) params.Weight = Number(Weight);
    const data = await this.send('POST', 'CreateRecord', params);
    return data && data.RecordID ? String(data.RecordID) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const value = Type === 'MX' ? `${Number(MX)} ${Value}` : Value;
    const params: Record<string, any> = { RecordID: RecordId, Host: Name, Type, Value: value, Line, TTL: Number(TTL), Remark: Remark ?? undefined };
    if (Weight && Weight > 0) params.Weight = Number(Weight);
    return (await this.send('POST', 'UpdateRecord', params)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('POST', 'DeleteRecord', { RecordID: RecordId })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const params: Record<string, any> = { RecordID: RecordId, Enable: Status === '1' };
    return (await this.send('POST', 'UpdateRecordStatus', params)) !== false;
  }

  async getRecordLine() {
    return {
      默认: 'default',
      电信: 'telecom',
      联通: 'unicom',
      移动: 'mobile',
      海外: 'oversea',
    };
  }

  async addDomain(Domain: string) {
    const data = await this.send('POST', 'CreateZone', { ZoneName: Domain });
    return data !== false;
  }
}