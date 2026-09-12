import { createHash, createHmac, randomUUID } from 'node:crypto';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class CtyunDeploy implements DeployProvider {
  private AccessKeyId: string;
  private SecretAccessKey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKeyId = config.AccessKeyId || '';
    this.SecretAccessKey = config.SecretAccessKey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private filterNull(obj: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && v !== undefined) out[k] = v;
    }
    return out;
  }

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey) throw new Error('必填参数不能为空');
    await this.request('GET', 'ctcdn-global.ctapi.ctyun.cn', '/v1/cert/query-cert-list');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    let certInfo;
    try {
      certInfo = parseCertPem(fullchain);
    } catch {
      throw new Error('证书解析失败');
    }
    config.cert_name = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    if (config.product === 'cdn') {
      await this.deployCdnLike('ctcdn-global.ctapi.ctyun.cn', fullchain, privatekey, config);
    } else if (config.product === 'icdn') {
      await this.deployCdnLike('icdn-global.ctapi.ctyun.cn', fullchain, privatekey, config);
    } else if (config.product === 'accessone') {
      await this.deployAccessone(fullchain, privatekey, config);
    } else if (config.product === 'cf') {
      await this.deployCf(fullchain, privatekey, config);
    }
  }

  private async deployCdnLike(endpoint: string, fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    let param = { name: config.cert_name, key: privatekey, certs: fullchain };
    try {
      await this.request('POST', endpoint, '/v1/cert/creat-cert', null, param);
    } catch (e: any) {
      if (e.message.includes('已存在重名的证书')) {
        this.log('已存在重名的证书 cert_name=' + config.cert_name);
      } else {
        throw new Error('上传证书失败：' + e.message);
      }
    }
    this.log('上传证书成功 cert_name=' + config.cert_name);

    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      param = { domain, https_status: 'on', cert_name: config.cert_name };
      try {
        await this.request('POST', endpoint, '/v1/domain/update-domain', null, param);
      } catch (e: any) {
        if (!e.message.includes('请求已提交，请勿重复操作！')) {
          throw new Error(e.message);
        }
      }
      this.log('CDN域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployAccessone(_fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    const endpoint = 'accessone-global.ctapi.ctyun.cn';
    let param = { name: config.cert_name, key: privatekey, certs: _fullchain };
    try {
      await this.request('POST', endpoint, '/ctapi/v1/accessone/cert/create', null, param);
    } catch (e: any) {
      if (e.message.includes('已存在重名的证书')) {
        this.log('已存在重名的证书 cert_name=' + config.cert_name);
      } else {
        throw new Error('上传证书失败：' + e.message);
      }
    }
    this.log('上传证书成功 cert_name=' + config.cert_name);

    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      let result: any;
      try {
        result = await this.request('POST', endpoint, '/ctapi/v1/accessone/domain/config', null, { domain, product_code: '020' });
      } catch (e: any) {
        throw new Error('查询域名配置失败：' + e.message);
      }

      if (result.https_status == 'on' && result.cert_name == config.cert_name) {
        this.log('边缘安全加速域名 ' + domain + ' 证书已部署，无需重复操作！');
        return;
      }

      result.https_status = 'on';
      result.cert_name = config.cert_name;
      const exclude_keys = [
        'status',
        'area_scope',
        'cname',
        'insert_date',
        'status_date',
        'record_status',
        'record_num',
        'customer_name',
        'outlink_replace_filter',
        'website_ipv6_access_mark',
        'websocket_speed',
        'dynamic_config',
        'dynamic_ability',
      ];
      for (const key of Object.keys(result)) {
        if (exclude_keys.includes(key) || (Array.isArray(result[key]) && result[key].length === 0)) {
          delete result[key];
        }
      }
      if (Array.isArray(result.origin)) {
        for (const origin of result.origin) {
          origin.weight = String(origin.weight);
        }
      }

      try {
        await this.request('POST', endpoint, '/ctapi/v1/scdn/domain/modify_config', null, result);
      } catch (e: any) {
        if (!e.message.includes('请求已提交，请勿重复操作！')) {
          throw new Error(e.message);
        }
      }

      this.log('边缘安全加速域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployCf(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    const endpoint = 'cf-global.ctapi.ctyun.cn';
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;

      let data: any;
      try {
        data = await this.request('GET', endpoint, '/openapi/v1/domains/customdomains/' + domain, null, null, { regionId: config.region_id });
      } catch (e: any) {
        throw new Error('获取自定义域名配置失败：' + e.message);
      }

      if (data?.certConfig?.certificate && String(data.certConfig.certificate).trim() === fullchain.trim()) {
        this.log('函数计算域名 ' + domain + ' 证书已部署，无需重复操作！');
        return;
      }

      if (data.protocol === 'HTTP') data.protocol = 'HTTP,HTTPS';
      const dash = config.cert_name.indexOf('-');
      const certName = 'cert' + config.cert_name.slice(dash + 1);
      const param = {
        domainName: domain,
        description: data.description,
        protocol: data.protocol,
        certConfig: {
          certName,
          certificate: fullchain,
          privateKey: privatekey,
        },
        authConfig: data.authConfig,
        routeConfig: data.routeConfig,
      };

      try {
        await this.request('PUT', endpoint, '/openapi/v1/domains/customdomains/' + domain, null, param, { regionId: config.region_id });
      } catch (e: any) {
        if (!e.message.includes('请求已提交，请勿重复操作！')) {
          throw new Error(e.message);
        }
      }

      this.log('函数计算域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async request(
    method: string,
    endpoint: string,
    path: string,
    query: Record<string, any> | null = null,
    params: Record<string, any> | null = null,
    header: Record<string, any> | null = null,
  ): Promise<any> {
    const q = query ? this.filterNull(query) : null;
    const p = params ? this.filterNull(params) : null;

    const time = Math.floor(Date.now() / 1000);
    const date = this.formatDate(time);
    const body = p && Object.keys(p).length ? JSON.stringify(p) : '';

    const headers: Record<string, string> = {
      Host: endpoint,
      'Eop-date': date,
      'ctyun-eop-request-id': createHash('md5')
        .update(randomUUID() + String(Date.now()) + String(Math.random()))
        .digest('hex'),
    };
    if (body) headers['Content-Type'] = 'application/json';
    if (header) Object.assign(headers, header);

    const authorization = this.generateSign(q, headers, body, date);
    headers['Eop-Authorization'] = authorization;

    let url = 'https://' + endpoint + path;
    if (q && Object.keys(q).length) url += '?' + new URLSearchParams(q as any).toString();

    const res = await fetch(url, { method, headers, body: body || undefined });
    const text = await res.text();
    let arr: any = null;
    try {
      arr = text ? JSON.parse(text) : null;
    } catch {
      arr = null;
    }

    if (arr && (arr.statusCode == 100000 || (arr.statusCode == 0 && endpoint === 'cf-global.ctapi.ctyun.cn'))) {
      return arr.returnObj !== undefined ? arr.returnObj : true;
    } else if (arr && arr.errorMessage) {
      throw new Error(arr.errorMessage);
    } else if (arr && arr.message) {
      throw new Error(arr.message);
    } else {
      throw new Error('返回数据解析失败');
    }
  }

  private generateSign(query: Record<string, any> | null, headers: Record<string, string>, body: string, date: string): string {
    const canonicalQueryString = this.getCanonicalQueryString(query);
    const [canonicalHeaders, signedHeaders] = this.getCanonicalHeaders(headers);
    const hashedRequestPayload = createHash('sha256').update(body).digest('hex');

    const stringToSign = canonicalHeaders + '\n' + canonicalQueryString + '\n' + hashedRequestPayload;

    const ktime = createHmac('sha256', this.SecretAccessKey).update(date).digest();
    const kAk = createHmac('sha256', ktime).update(this.AccessKeyId).digest();
    const kdate = createHmac('sha256', kAk).update(date.slice(0, 8)).digest();
    const signature = createHmac('sha256', kdate).update(stringToSign).digest().toString('base64');

    return this.AccessKeyId + ' Headers=' + signedHeaders + ' Signature=' + signature;
  }

  private escape(str: string): string {
    return encodeURIComponent(str).replace(/\*/g, '%2A');
  }

  private getCanonicalQueryString(params: Record<string, any> | null): string {
    if (!params || !Object.keys(params).length) return '';
    const keys = Object.keys(params).sort();
    let s = '';
    for (const k of keys) {
      s += '&' + this.escape(k) + '=' + this.escape(String(params[k]));
    }
    return s.slice(1);
  }

  private getCanonicalHeaders(oldHeaders: Record<string, string>): [string, string] {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(oldHeaders)) headers[k.toLowerCase()] = v.trim();
    const keys = Object.keys(headers).sort();

    let canonicalHeaders = '';
    let signedHeaders = '';
    for (const k of keys) {
      canonicalHeaders += k + ':' + headers[k] + '\n';
      signedHeaders += k + ';';
    }
    signedHeaders = signedHeaders.slice(0, -1);
    return [canonicalHeaders, signedHeaders];
  }

  private formatDate(time: number): string {
    const d = new Date(time * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}