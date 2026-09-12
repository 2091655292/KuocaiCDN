import type { DnsProvider, DomainListResult, RecordListResult, RecordInfo } from '../types.js';

export class GoEdgeDns implements DnsProvider {
  private baseUrl: string;
  private accessKeyId: string;
  private accessKey: string;
  private userType: string;
  private nsClusterId: number;
  private userId: number;
  private accessToken: string | null = null;
  private error = '';
  private domain: string;
  private domainid: string;

  constructor(config: Record<string, any>) {
    this.baseUrl = String(config.base_url || '').replace(/\/+$/, '');
    this.accessKeyId = String(config.accessKeyId || '').trim();
    this.accessKey = String(config.accessKey || '').trim();
    this.userType = String(config.type || config.usertype || 'admin').toLowerCase();
    this.nsClusterId = Number(config.nsClusterId || 0);
    this.userId = Number(config.userId || 0);
    this.domain = config.domain ? String(config.domain) : '';
    this.domainid = config.domainid ? String(config.domainid) : '';
  }

  getError() {
    return this.error;
  }

  private setError(message: string) {
    this.error = message;
  }

  private async getAccessToken(): Promise<void> {
    const res = await fetch(this.baseUrl + '/APIAccessTokenService/getAPIAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: this.userType, accessKeyId: this.accessKeyId, accessKey: this.accessKey }),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('获取GoEdge AccessToken失败');
    }
    if (res.status !== 200 || result?.code !== 200 || !result?.data?.token) {
      throw new Error(result?.message || '获取GoEdge AccessToken失败');
    }
    this.accessToken = String(result.data.token);
  }

  private async request(path: string, payload: Record<string, any>): Promise<any> {
    if (this.accessToken === null) await this.getAccessToken();
    const body = JSON.stringify(Object.keys(payload).length === 0 ? {} : payload);
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Edge-Access-Token': this.accessToken!,
      },
      body,
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (res.status !== 200 || !result || result.code !== 200) {
      throw new Error(result?.message || 'GoEdge API请求失败');
    }
    return result.data ?? {};
  }

  private withUserId(payload: Record<string, any>): Record<string, any> {
    if (this.userType === 'admin' && this.userId > 0) payload.userId = this.userId;
    return payload;
  }

  private domainQuery(keyword: string | null = null): Record<string, any> {
    const payload: Record<string, any> = { nsClusterId: this.nsClusterId };
    if (keyword) payload.keyword = keyword;
    return this.withUserId(payload);
  }

  private routeCodes(line: string): string[] {
    const codes = (line || '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    return [...new Set(codes)].length ? [...new Set(codes)] : ['default'];
  }

  private normalizeRecord(record: Record<string, any>): RecordInfo {
    const routeCodes: string[] = [];
    const routeNames: string[] = [];
    for (const route of record.nsRoutes || []) {
      if (!route?.code) continue;
      routeCodes.push(String(route.code));
      if (route.name) routeNames.push(String(route.name));
    }
    return {
      RecordId: String(record.id ?? ''),
      Domain: this.domain,
      Name: record.name ?? '',
      Type: record.type ?? '',
      Value: record.value ?? '',
      Line: routeCodes.length ? routeCodes.join(',') : 'default',
      TTL: Number(record.ttl || 0),
      MX: Number(record.mxPriority || 0),
      Status: record.isOn ? '1' : '0',
      Weight: Number(record.weight || 0),
      Remark: record.description ?? '',
      UpdateTime: record.createdAt ? formatTime(Number(record.createdAt)) : null,
    };
  }

  async check() {
    if (this.baseUrl === '' || this.accessKeyId === '' || this.accessKey === '') {
      this.setError('API地址、AccessKey ID和AccessKey不能为空');
      return false;
    }
    if (this.userType !== 'admin' && this.userType !== 'user') {
      this.setError('AccessKey类型必须是admin或user');
      return false;
    }
    if (this.nsClusterId <= 0) {
      this.setError('DNS集群ID必须大于0');
      return false;
    }
    try {
      const data = await this.request('/NSClusterService/findNSCluster', { nsClusterId: this.nsClusterId });
      return data.nsCluster && typeof data.nsCluster === 'object';
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async getDomainList(KeyWord: string | null = null, PageNumber = 1, PageSize = 20): Promise<DomainListResult | false> {
    try {
      const countData = await this.request('/NSDomainService/countAllNSDomains', this.domainQuery(KeyWord));
      const listData = await this.request('/NSDomainService/listNSDomains', {
        ...this.domainQuery(KeyWord),
        offset: Math.max(0, (PageNumber - 1) * PageSize),
        size: Math.max(1, PageSize),
      });
      const list = (listData.nsDomains || []).map((row: any) => ({
        DomainId: row.id ?? null,
        Domain: row.name ?? '',
        RecordCount: 0,
      }));
      return { total: Number(countData.count ?? list.length), list };
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async getDomainRecords(
    PageNumber = 1,
    PageSize = 20,
    KeyWord: string | null = null,
    SubDomain: string | null = null,
    Value: string | null = null,
    _Type: string | null = null,
    Line: string | null = null,
    Status: string | null = null,
  ): Promise<RecordListResult | false> {
    if (!this.domainid) {
      this.setError('GoEdge域名ID不能为空');
      return false;
    }
    const hasLocalFilter = !!SubDomain || !!Value || !!Status;
    const payload: Record<string, any> = {
      nsDomainId: Number(this.domainid),
      offset: hasLocalFilter ? 0 : Math.max(0, (PageNumber - 1) * PageSize),
      size: hasLocalFilter ? 1000 : Math.max(1, PageSize),
    };
    if (KeyWord) payload.keyword = KeyWord;
    if (_Type) payload.type = _Type;
    if (Line) payload.nsRouteCode = this.routeCodes(Line)[0];
    try {
      const data = await this.request('/NSRecordService/listNSRecords', payload);
      let list: RecordInfo[] = [];
      for (const record of data.nsRecords || []) {
        const row = this.normalizeRecord(record);
        if (SubDomain && row.Name.toLowerCase() !== SubDomain.toLowerCase()) continue;
        if (Value && !row.Value.toLowerCase().includes(Value.toLowerCase())) continue;
        if (Status && row.Status !== Status) continue;
        list.push(row);
      }
      const total = list.length;
      if (hasLocalFilter) {
        const offset = Math.max(0, (PageNumber - 1) * PageSize);
        list = list.slice(offset, offset + Math.max(1, PageSize));
      }
      return { total, list };
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async getDomainRecordInfo(RecordId: string): Promise<RecordInfo | false> {
    try {
      const data = await this.request('/NSRecordService/findNSRecord', { nsRecordId: Number(RecordId) });
      if (!data.nsRecord) return false;
      return this.normalizeRecord(data.nsRecord);
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async addDomainRecord(Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    try {
      const data = await this.request('/NSRecordService/createNSRecord', {
        nsDomainId: Number(this.domainid),
        name: Name,
        type: Type,
        value: Value,
        ttl: Math.max(1, Number(TTL)),
        nsRouteCodes: this.routeCodes(Line),
        weight: Weight === null ? 0 : Number(Weight),
        mxPriority: Type === 'MX' ? Math.max(0, Number(MX)) : 0,
        description: Remark === null ? '' : Remark,
      });
      return data.nsRecordId ? String(data.nsRecordId) : false;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async updateDomainRecord(RecordId: string, Name: string, Type: string, Value: string, Line = 'default', TTL = 600, MX = 1, Weight: number | null = null, Remark: string | null = null) {
    const current = await this.getDomainRecordInfo(RecordId);
    if (!current) return false;
    try {
      await this.request('/NSRecordService/updateNSRecord', {
        nsRecordId: Number(RecordId),
        isOn: current.Status !== '0',
        name: Name,
        type: Type,
        value: Value,
        ttl: Math.max(1, Number(TTL)),
        nsRouteCodes: this.routeCodes(Line),
        weight: Weight === null ? Number(current.Weight) : Number(Weight),
        mxPriority: Type === 'MX' ? Math.max(0, Number(MX)) : 0,
        description: Remark === null ? '' : Remark,
      });
      return true;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async deleteDomainRecord(RecordId: string) {
    try {
      await this.request('/NSRecordService/deleteNSRecord', { nsRecordId: Number(RecordId) });
      return true;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async setDomainRecordStatus(RecordId: string, Status: string) {
    const current = await this.getDomainRecordInfo(RecordId);
    if (!current) return false;
    try {
      await this.request('/NSRecordService/updateNSRecord', {
        nsRecordId: Number(RecordId),
        isOn: Status === '1',
        name: current.Name,
        type: current.Type,
        value: current.Value,
        ttl: Math.max(1, Number(current.TTL)),
        nsRouteCodes: this.routeCodes(current.Line),
        weight: Number(current.Weight),
        mxPriority: current.Type.toUpperCase() === 'MX' ? Number(current.MX) : 0,
        description: String(current.Remark ?? ''),
      });
      return true;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async getRecordLine(): Promise<Record<string, string> | false> {
    const methods = [
      '/NSRouteService/findAllDefaultWorldRegionRoutes',
      '/NSRouteService/findAllDefaultChinaProvinceRoutes',
      '/NSRouteService/findAllDefaultISPRoutes',
      '/NSRouteService/findAllAgentNSRoutes',
    ];
    const map = new Map<string, string>();
    try {
      for (const method of methods) {
        const data = await this.request(method, {});
        for (const route of data.nsRoutes || []) {
          if (!route?.code || map.has(route.code)) continue;
          map.set(route.code, route.name || route.code);
        }
      }
      if (this.domainid) {
        const data = await this.request('/NSRouteService/findAllNSRoutes', {});
        for (const route of data.nsRoutes || []) {
          if (!route?.code || map.has(route.code)) continue;
          map.set(route.code, route.name || route.code);
        }
      }
      const list: Record<string, string> = { 默认线路: 'default' };
      for (const [code, name] of map) {
        if (code === 'default') continue;
        if (list[name] === undefined) list[name] = code;
        else list[`${name}#${code}`] = code;
      }
      return list;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }

  async addDomain(Domain: string) {
    try {
      const payload = this.withUserId({ nsClusterId: this.nsClusterId, name: Domain });
      const data = await this.request('/NSDomainService/createNSDomain', payload);
      return data.nsDomainId ? true : false;
    } catch (e: any) {
      this.setError(e.message || String(e));
      return false;
    }
  }
}

function formatTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}