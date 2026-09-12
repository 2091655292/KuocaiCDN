import { TencentCloud } from '../../clients/TencentCloud.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class TencentEoDns implements DnsProvider {
  private client: TencentCloud;
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    const endpoint = config.site_type === 'intl' ? 'teo.intl.tencentcloudapi.com' : 'teo.tencentcloudapi.com';
    this.client = new TencentCloud(config.SecretId, config.SecretKey, endpoint, 'teo', '2022-09-01');
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private async send(action: string, param: Record<string, any>): Promise<any> {
    try {
      return await this.client.request(action, param);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const filters: any[] = [{ Name: 'zone-type', Values: ['full'] }];
    if (KeyWord) filters.push({ Name: 'zone-name', Values: [KeyWord] });
    const data = await this.send('DescribeZones', { Offset: (PageNumber - 1) * PageSize, Limit: PageSize, Filters: filters });
    if (!data) return false;
    const list = (data.Zones || []).map((row: any) => ({ DomainId: row.ZoneId, Domain: row.ZoneName, RecordCount: 0 }));
    return { total: data.TotalCount || 0, list };
  }

  private extractRow(row: any): RecordInfo {
    let name = String(row.Name || '').slice(0, -(this.domain.length + 1));
    if (name === '') name = '@';
    return {
      RecordId: row.RecordId,
      Domain: this.domain,
      Name: name,
      Type: row.Type,
      Value: row.Content,
      Line: row.Location ?? 'Default',
      TTL: row.TTL,
      MX: row.Priority ?? null,
      Status: row.Status === 'enable' ? '1' : '0',
      Weight: row.Weight === -1 || row.Weight == null ? null : row.Weight,
      Remark: null,
      UpdateTime: row.ModifiedOn ?? null,
    };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
  ): Promise<RecordListResult | false> {
    const filters: any[] = [];
    if (SubDomain) {
      const name = SubDomain === '@' ? this.domain : SubDomain + '.' + this.domain;
      filters.push({ Name: 'name', Values: [name] });
    } else if (KeyWord) {
      const name = KeyWord === '@' ? this.domain : KeyWord + '.' + this.domain;
      filters.push({ Name: 'name', Values: [name] });
    }
    if (Value) filters.push({ Name: 'content', Values: [Value], Fuzzy: true });
    if (Type) filters.push({ Name: 'type', Values: [Type] });
    const param: Record<string, any> = { ZoneId: this.domainid, Offset: (PageNumber - 1) * PageSize, Limit: PageSize, Filters: filters };
    const data = await this.send('DescribeDnsRecords', param);
    if (!data) return false;
    const list = (data.DnsRecords || []).map((row: any) => this.extractRow(row));
    return { total: data.TotalCount || 0, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.send('DescribeDnsRecords', { ZoneId: this.domainid, Filters: [{ Name: 'id', Values: [RecordId] }] });
    if (!data?.DnsRecords?.length) return false;
    return this.extractRow(data.DnsRecords[0]);
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'Default', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const name = Name === '@' ? this.domain : Name + '.' + this.domain;
    const param: Record<string, any> = {
      ZoneId: this.domainid,
      Name: name,
      Type,
      Content: Value,
      Location: Line,
      TTL: Number(TTL),
      Weight: Weight ? Number(Weight) : -1,
    };
    if (Type === 'MX') param.Priority = Number(MX);
    const data = await this.send('CreateDnsRecord', param);
    return data && data.RecordId ? String(data.RecordId) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'Default', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const name = Name === '@' ? this.domain : Name + '.' + this.domain;
    const param: Record<string, any> = {
      ZoneId: this.domainid,
      DnsRecordId: RecordId,
      Name: name,
      Type,
      Content: Value,
      Location: Line,
      TTL: Number(TTL),
      Weight: Weight ? Number(Weight) : -1,
    };
    if (Type === 'MX') param.Priority = Number(MX);
    return (await this.send('ModifyDnsRecord', param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('DeleteDnsRecords', { ZoneId: this.domainid, RecordIds: [RecordId] })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const param: Record<string, any> = { ZoneId: this.domainid };
    if (Status === '1') param.RecordsToEnable = [RecordId];
    else param.RecordsToDisable = [RecordId];
    return (await this.send('ModifyDnsRecordsStatus', param)) !== false;
  }

  async getRecordLine() {
    return { 默认: 'Default' };
  }

  async addDomain(_Domain: string) {
    return false;
  }
}