import { Aliyun } from '../../clients/Aliyun.js';
import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class AliyunEsaDns implements DnsProvider {
  private client: Aliyun;
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    const endpoint = config.region ? `esa.${config.region}.aliyuncs.com` : 'esa.cn-hangzhou.aliyuncs.com';
    this.client = new Aliyun(config.AccessKeyId, config.AccessKeySecret, endpoint, '2024-09-10');
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private async request(param: Record<string, any>, method: 'GET' | 'POST' = 'POST', returnData = false): Promise<any> {
    try {
      const result = await this.client.request(param, method);
      return returnData ? result : true;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList(null, 1, 20)) !== false;
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.request({ Action: 'ListSites', SiteName: KeyWord ?? undefined, PageNumber, PageSize, AccessType: 'NS' }, 'GET', true);
    if (!data) return false;
    const list = (data.Sites || []).map((row: any) => ({ DomainId: row.SiteId, Domain: row.SiteName, RecordCount: 0 }));
    return { total: data.TotalCount || 0, list };
  }

  private extractRow(row: any): any {
    let name = String(row.RecordName || '').slice(0, -(this.domain.length + 1));
    if (name === '') name = '@';
    let type = row.RecordType;
    let value = row.Data?.Value ?? '';
    if (row.RecordType === 'CAA') value = `${row.Data?.Flag ?? 0} ${row.Data?.Tag ?? ''} ${row.Data?.Value ?? ''}`;
    else if (row.RecordType === 'SRV') value = `${row.Data?.Priority ?? 0} ${row.Data?.Weight ?? 0} ${row.Data?.Port ?? 0} ${row.Data?.Value ?? ''}`;
    if (row.RecordType === 'A/AAAA') {
      type = /^\d+\.\d+\.\d+\.\d+/.test(value) ? 'A' : 'AAAA';
    }
    return {
      RecordId: row.RecordId,
      Domain: this.domain,
      Name: name,
      Type: type,
      Value: value,
      Line: row.Proxied ? '1' : '0',
      TTL: row.Ttl,
      MX: row.Data?.Priority ?? null,
      Status: '1',
      Weight: null,
      Remark: row.Comment ?? null,
      UpdateTime: row.UpdateTime ?? null,
    };
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    _Value: string | null = null,
    Type: string | null = null,
    Line: string | null = null,
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const param: Record<string, any> = { Action: 'ListRecords', SiteId: this.domainid, PageNumber, PageSize };
    if (SubDomain) {
      const rn = SubDomain === '@' ? this.domain : SubDomain + '.' + this.domain;
      param.RecordName = rn;
    } else if (KeyWord) {
      param.RecordName = KeyWord === '@' ? this.domain : KeyWord + '.' + this.domain;
    }
    if (Type) param.Type = Type === 'A' || Type === 'AAAA' ? 'A/AAAA' : Type;
    if (Line) param.Proxied = Line === '1' ? 'true' : 'false';
    const data = await this.request(param, 'GET', true);
    if (!data) return false;
    const list = (data.Records || []).map((row: any) => this.extractRow(row));
    return { total: data.TotalCount || 0, list };
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    const data = await this.request({ Action: 'GetRecord', RecordId }, 'GET', true);
    if (!data?.RecordModel) return false;
    return this.extractRow(data.RecordModel);
  }

  private buildData(type: string, value: string, mx: number | null): Record<string, any> {
    if (type === 'CAA') {
      const parts = value.split(' ');
      return { Flag: Number(parts[0] || 0), Tag: parts[1] || '', Value: parts.slice(2).join(' ') };
    }
    if (type === 'SRV') {
      const parts = value.split(' ');
      return { Priority: Number(parts[0] || 0), Weight: Number(parts[1] || 0), Port: Number(parts[2] || 0), Value: parts.slice(3).join(' ') };
    }
    const data: Record<string, any> = { Value: value };
    if (type === 'MX') data.Priority = Number(mx ?? 1);
    return data;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const rn = Name === '@' ? this.domain : Name + '.' + this.domain;
    const type = Type === 'A' || Type === 'AAAA' ? 'A/AAAA' : Type;
    const data = this.buildData(Type, Value, MX);
    const param: Record<string, any> = {
      Action: 'CreateRecord',
      SiteId: this.domainid,
      RecordName: rn,
      Type: type,
      Proxied: Line === '1' ? 'true' : 'false',
      Ttl: Number(TTL),
      Data: JSON.stringify(data),
      Comment: Remark ?? undefined,
    };
    if (Line === '1') param.BizName = 'web';
    const res = await this.request(param, 'POST', true);
    return res && res.RecordId ? String(res.RecordId) : false;
  }

  async updateDomainRecord(RecordId: string, _Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, _Weight: number | null = null, Remark: string | null = null) {
    const type = Type === 'A' || Type === 'AAAA' ? 'A/AAAA' : Type;
    const data = this.buildData(Type, Value, MX);
    const param: Record<string, any> = {
      Action: 'UpdateRecord',
      RecordId,
      Type: type,
      Proxied: Line === '1' ? 'true' : 'false',
      Ttl: Number(TTL),
      Data: JSON.stringify(data),
      Comment: Remark ?? undefined,
    };
    if (Line === '1') param.BizName = 'web';
    return (await this.request(param, 'POST')) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.request({ Action: 'DeleteRecord', RecordId }, 'POST')) !== false;
  }

  async setDomainRecordStatus(_RecordId: string, _Status: string) {
    this.error = '阿里云 ESA 不支持记录级启用/暂停';
    return false;
  }

  async getRecordLine() {
    return {
      仅DNS: '0',
      已代理: '1',
    };
  }

  async addDomain(_Domain: string) {
    return false;
  }
}