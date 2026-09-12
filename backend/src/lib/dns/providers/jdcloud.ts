import { Jdcloud } from '../../clients/Jdcloud.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class JdcloudDns implements DnsProvider {
  private client: Jdcloud;
  private error = '';
  private domain: string;
  private domainid: string;
  private version = 'v2';
  private region = 'cn-north-1';

  constructor(config: Record<string, any>) {
    this.client = new Jdcloud(config.AccessKeyId, config.AccessKeySecret, 'domainservice.jdcloud-api.com', 'domainservice', this.region);
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private async send(method: string, action: string, params: Record<string, any> = {}): Promise<any> {
    const path = `/${this.version}/regions/${this.region}${action}`;
    try {
      return await this.client.request(method, path, params);
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.send('GET', '/domain', { pageNumber: PageNumber, pageSize: PageSize, domainName: KeyWord ?? undefined });
    if (!data) return false;
    const list = (data.dataList || []).map((row: any) => ({ DomainId: row.id, Domain: row.domainName, RecordCount: 0 }));
    return { total: data.totalCount || 0, list };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    _Value: string | null = null,
    _Type: string | null = null,
    _Line: string | null = null,
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    if (PageSize > 99) PageSize = 99;
    const query: Record<string, any> = { pageNumber: PageNumber, pageSize: PageSize };
    if (SubDomain) query.search = SubDomain.toLowerCase();
    else if (KeyWord) query.search = KeyWord;
    const data = await this.send('GET', '/domain/' + this.domainid + '/ResourceRecord', query);
    if (!data) return false;
    let list = (data.dataList || []).map((row: any) => {
      let value = row.hostValue;
      if (row.type === 'SRV') value = `${row.mxPriority} ${row.weight} ${row.port} ${row.hostValue}`;
      return {
        RecordId: row.id,
        Domain: this.domain,
        Name: row.hostRecord,
        Type: row.type,
        Value: value,
        Line: Array.isArray(row.viewValue) && row.viewValue.length ? row.viewValue[row.viewValue.length - 1] : row.viewValue,
        TTL: row.ttl,
        MX: row.mxPriority ?? null,
        Status: row.resolvingStatus == '2' ? '1' : '0',
        Weight: row.weight ?? null,
        Remark: null,
        UpdateTime: row.updateTime ? new Date(row.updateTime * 1000).toISOString().slice(0, 19).replace('T', ' ') : null,
      };
    });
    if (SubDomain) list = list.filter((v: any) => v.Name === SubDomain);
    return { total: data.totalCount || 0, list };
  }

  async getDomainRecordInfo(_RecordId: string): Promise<RecordInfo | false> {
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '-1', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const type = this.convertType(Type);
    const params: Record<string, any> = { hostRecord: Name, type, hostValue: Value, viewValue: Number(Line), ttl: Number(TTL) };
    if (Type === 'MX') params.mxPriority = Number(MX);
    if (Weight !== null && Weight !== undefined) params.weight = Number(Weight);
    const data = await this.send('POST', '/domain/' + this.domainid + '/ResourceRecord', { req: params });
    return data && data.dataList?.id ? String(data.dataList.id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = '-1', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const type = this.convertType(Type);
    const params: Record<string, any> = { hostRecord: Name, type, hostValue: Value, viewValue: Number(Line), ttl: Number(TTL) };
    if (Type === 'MX') params.mxPriority = Number(MX);
    if (Weight !== null && Weight !== undefined) params.weight = Number(Weight);
    return (await this.send('PUT', '/domain/' + this.domainid + '/ResourceRecord/' + RecordId, { req: params })) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.send('DELETE', '/domain/' + this.domainid + '/ResourceRecord/' + RecordId)) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const params = { action: Status === '1' ? 'enable' : 'disable' };
    return (await this.send('PUT', '/domain/' + this.domainid + '/ResourceRecord/' + RecordId + '/status', params)) !== false;
  }

  async getRecordLine() {
    return {
      默认: '-1',
      电信: '1',
      联通: '2',
      移动: '3',
      海外: '4',
    };
  }

  async addDomain(Domain: string) {
    return (await this.send('POST', '/domain', { domainName: Domain })) !== false;
  }

  private convertType(type: string): string {
    return type === 'REDIRECT_URL' ? 'EXPLICIT_URL' : type === 'FORWARD_URL' ? 'IMPLICIT_URL' : type;
  }
}