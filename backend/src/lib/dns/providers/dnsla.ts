import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

const typeList: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA', 256: 'URL转发' };

function formatTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class Dnsla implements DnsProvider {
  private apiid: string;
  private apisecret: string;
  private baseUrl = 'https://api.dns.la';
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    this.apiid = config.apiid || '';
    this.apisecret = config.apisecret || '';
    this.domain = config.domain || '';
    this.domainid = config.domainid || '';
  }

  getError() {
    return this.error;
  }

  private convertType(type: string): number {
    for (const [id, name] of Object.entries(typeList)) {
      if (name === type) return Number(id);
    }
    return 1;
  }

  private convertTypeId(typeId: number, domaint: boolean | undefined): string {
    if (typeId === 256) return domaint ? 'REDIRECT_URL' : 'FORWARD_URL';
    return typeList[typeId] || 'A';
  }

  private async execute(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: Record<string, any> | null = null): Promise<any> {
    try {
      const headers: Record<string, string> = {
        Authorization: 'Basic ' + Buffer.from(this.apiid + ':' + this.apisecret).toString('base64'),
        'Content-Type': 'application/json; charset=utf-8',
      };
      let url = this.baseUrl + path;
      const init: RequestInit = { method, headers };
      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        init.body = JSON.stringify(params ?? {});
      } else if (params) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (v !== null && v !== undefined) qs.append(k, String(v));
        }
        url += '?' + qs.toString();
      }
      const res = await fetch(url, init);
      if (res.status === 401) {
        this.error = '认证失败';
        return false;
      }
      if (res.status !== 200) {
        this.error = 'http code: ' + res.status;
        return false;
      }
      const arr = await res.json();
      if (arr && arr.code === 200) return arr.data;
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
    const data = await this.execute('GET', '/api/domainList', { pageIndex: PageNumber, pageSize: PageSize });
    if (!data) return false;
    const list = (data.results || []).map((row: any) => ({
      DomainId: row.id,
      Domain: String(row.displayDomain || '').replace(/\.$/, ''),
      RecordCount: 0,
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
    _Status: string | null = null,
  ): Promise<RecordListResult | false> {
    const param: Record<string, any> = { domainId: this.domainid, pageIndex: PageNumber, pageSize: PageSize };
    if (KeyWord) param.host = KeyWord;
    if (SubDomain) param.host = SubDomain;
    if (Type) param.type = this.convertType(Type);
    if (Line) param.lineId = Line;
    if (Value) param.data = Value;
    const data = await this.execute('GET', '/api/recordList', param);
    if (!data) return false;
    const list: RecordInfo[] = (data.results || []).map((row: any) => ({
      RecordId: row.id,
      Domain: this.domain,
      Name: row.host,
      Type: this.convertTypeId(row.type, row.domaint),
      Value: row.data,
      Line: row.lineId,
      TTL: row.ttl,
      MX: row.preference ?? null,
      Status: row.disable ? '0' : '1',
      Weight: row.weight ?? null,
      Remark: null,
      UpdateTime: row.updatedAt ? formatTime(row.updatedAt) : null,
    }));
    return { total: data.total || 0, list };
  }

  async getDomainRecordInfo(_RecordId: string) {
    return false;
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const param: Record<string, any> = {
      domainId: this.domainid,
      type: this.convertType(Type),
      host: Name,
      data: Value,
      ttl: Number(TTL),
      lineId: Line,
    };
    if (Type === 'MX') param.preference = Number(MX);
    if (Type === 'REDIRECT_URL') {
      param.type = 256;
      param.dominant = true;
    } else if (Type === 'FORWARD_URL') {
      param.type = 256;
      param.dominant = false;
    }
    if (Weight && Weight > 0) param.weight = Weight;
    const data = await this.execute('POST', '/api/record', param);
    return data && data.id ? String(data.id) : false;
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = '0', TTL = 600, MX = 1, Weight: number | null = null, _Remark: string | null = null) {
    const param: Record<string, any> = {
      id: RecordId,
      type: this.convertType(Type),
      host: Name,
      data: Value,
      ttl: Number(TTL),
      lineId: Line,
    };
    if (Type === 'MX') param.preference = Number(MX);
    if (Type === 'REDIRECT_URL') {
      param.type = 256;
      param.dominant = true;
    } else if (Type === 'FORWARD_URL') {
      param.type = 256;
      param.dominant = false;
    }
    if (Weight && Weight > 0) param.weight = Weight;
    return (await this.execute('PUT', '/api/record', param)) !== false;
  }

  async deleteDomainRecord(RecordId: string) {
    return (await this.execute('DELETE', '/api/record', { id: RecordId })) !== false;
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    return (await this.execute('PUT', '/api/recordDisable', { id: RecordId, disable: Status === '0' })) !== false;
  }

  async getRecordLine(): Promise<Record<string, string> | false> {
    const data = await this.execute('GET', '/api/availableLine', { domain: this.domain });
    if (!data) return false;
    const rows = [...(data || [])].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    const byId = new Map(rows.map((row: any) => [String(row.id), row]));
    const list: Record<string, string> = {};
    for (const row of rows) {
      const id = String(row.id) === '0' ? '' : String(row.id);
      let label = row.value;
      if (list[label] !== undefined && list[label] !== id) {
        const parent = row.pid ? byId.get(String(row.pid)) : null;
        if (parent) label = `${parent.value}-${row.value}`;
        if (list[label] !== undefined && list[label] !== id) label = `${label}#${id}`;
      }
      list[label] = id;
    }
    return list;
  }

  async addDomain(Domain: string) {
    const data = await this.execute('POST', '/api/domain', { domain: Domain });
    if (data && data.id) return true;
    return false;
  }
}