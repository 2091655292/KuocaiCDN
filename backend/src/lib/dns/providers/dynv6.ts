import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class Dynv6Dns implements DnsProvider {
  private token: string;
  private baseUrl = 'https://dynv6.com/api/v2';
  private error = '';
  private domain: string;
  private zoneID: number | null = null;

  constructor(config: Record<string, any>) {
    this.token = config.token || '';
    this.domain = config.domain || '';
  }

  getError() {
    return this.error;
  }

  private async getZoneID(): Promise<number | false> {
    if (this.zoneID !== null) return this.zoneID;
    const data = await this.sendRequest('GET', '/zones/by-name/' + this.domain);
    if (data && data.id !== undefined) {
      this.zoneID = data.id;
      return this.zoneID;
    }
    this.error = '无法获取域名的Zone ID，请确认域名已添加到dynv6';
    return false;
  }

  private async sendRequest(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, params: Record<string, any> | null = null): Promise<any> {
    try {
      const headers: Record<string, string> = { Authorization: 'Bearer ' + this.token };
      let url = this.baseUrl + path;
      const init: RequestInit = { method, headers };
      if (method === 'GET' || method === 'DELETE') {
        if (params) {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
          url += '?' + qs.toString();
        }
      } else if (params) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(params);
      }
      const res = await fetch(url, init);
      if (res.status === 204) return true;
      const text = await res.text();
      let arr: any = null;
      if (text) {
        try {
          arr = JSON.parse(text);
        } catch {
          arr = null;
        }
      }
      if (res.status >= 200 && res.status < 300) {
        return arr !== null ? arr : true;
      }
      if (arr?.error) this.error = arr.error;
      else if (arr?.message) this.error = arr.message;
      else this.error = `HTTP ${res.status}: ${text}`;
      return false;
    } catch (e: any) {
      this.error = e.message || String(e);
      return false;
    }
  }

  async check() {
    return (await this.getDomainList()) !== false;
  }

  async getDomainList(KeyWord: string | null = null, _PageNumber = 1, _PageSize = 20): Promise<DomainListResult | false> {
    const data = await this.sendRequest('GET', '/zones');
    if (data === false) return false;
    let list: any[] = [];
    if (Array.isArray(data)) {
      list = data
        .filter((row: any) => row.name)
        .map((row: any) => ({ DomainId: row.id ?? 0, Domain: row.name, RecordCount: 0 }));
    }
    if (KeyWord) {
      list = list.filter((v) => v.Domain.includes(KeyWord));
    }
    return { total: list.length, list };
  }

  async getDomainRecords(
    _PageNumber = 1,
    _PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    Type: string | null = null,
  ): Promise<RecordListResult | false> {
    const zoneID = await this.getZoneID();
    if (zoneID === false) return false;
    const data = await this.sendRequest('GET', '/zones/' + zoneID + '/records');
    if (data === false || data === true) return false;
    let rows: any[] = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (data) {
      rows = [data];
    }
    let list: RecordInfo[] = rows.map((row: any) => {
      let name = row.name || '';
      const type = String(row.type || '').toUpperCase();
      if (!name || name === this.domain) {
        name = '@';
      } else if (name.endsWith('.' + this.domain)) {
        name = name.slice(0, -(this.domain.length + 1));
      }
      return {
        RecordId: row.id,
        Domain: this.domain,
        Name: name,
        Type: type,
        Value: row.data || '',
        Line: 'default',
        TTL: 600,
        MX: type === 'MX' && row.priority !== undefined ? row.priority : null,
        Status: '1',
        Weight: null,
        Remark: null,
        UpdateTime: null,
      };
    });
    if (SubDomain) {
      list = list.filter((v) => v.Name.toLowerCase() === SubDomain.toLowerCase());
    } else {
      if (KeyWord) list = list.filter((v) => v.Name.includes(KeyWord) || v.Value.includes(KeyWord));
      if (Value) list = list.filter((v) => v.Value === Value);
      if (Type) list = list.filter((v) => v.Type === Type);
    }
    return { total: list.length, list };
  }

  async getDomainRecordInfo(_RecordId: string) {
    return false;
  }

  private encodeFqdn(Name: string): string {
    return Name === '@' || !Name ? this.domain : Name;
  }

  private encodeValue(Type: string, Value: string): string {
    if (Type === 'CNAME' || Type === 'MX') {
      if (Value && !Value.endsWith('.') && Value.includes('.')) {
        return Value + '.';
      }
    }
    return Value;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, _Line = 'default', _TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    if (!Value && Value !== '0') {
      this.error = '记录值不能为空';
      return false;
    }
    const zoneID = await this.getZoneID();
    if (zoneID === false) return false;
    const params: Record<string, any> = {
      name: this.encodeFqdn(Name),
      type: Type,
      data: this.encodeValue(Type, Value),
    };
    if (Type === 'MX') params.priority = Number(MX);
    const data = await this.sendRequest('POST', '/zones/' + zoneID + '/records', params);
    if (data && data.id !== undefined) return String(data.id);
    return false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, _Line = 'default', _TTL = 600, MX = 1, _Weight: number | null = null, _Remark: string | null = null) {
    if (!Value && Value !== '0') {
      this.error = '记录值不能为空';
      return false;
    }
    const zoneID = await this.getZoneID();
    if (zoneID === false) return false;
    const params: Record<string, any> = {
      name: this.encodeFqdn(Name),
      type: Type,
      data: this.encodeValue(Type, Value),
    };
    if (Type === 'MX') params.priority = Number(MX);
    return (await this.sendRequest('PATCH', '/zones/' + zoneID + '/records/' + RecordId, params)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    const zoneID = await this.getZoneID();
    if (zoneID === false) return false;
    return (await this.sendRequest('DELETE', '/zones/' + zoneID + '/records/' + RecordId)) !== false;
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