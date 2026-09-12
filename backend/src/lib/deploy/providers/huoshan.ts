import { createHash, createHmac } from 'node:crypto';
import { Volcengine } from '../../clients/Volcengine.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function esc(str: string): string {
  return encodeURIComponent(str).replace(/%2B/g, '%20').replace(/%2A/g, '%2A').replace(/%7E/g, '~');
}

function canonicalQueryString(parameters: Record<string, any>): string {
  if (!parameters || !Object.keys(parameters).length) return '';
  const keys = Object.keys(parameters).sort();
  let qs = '';
  for (const key of keys) {
    if (parameters[key] === null || parameters[key] === undefined) continue;
    qs += '&' + esc(key) + '=' + esc(String(parameters[key]));
  }
  return qs.slice(1);
}

function canonicalHeaders(headers: Record<string, string>): [string, string] {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim();
  const keys = Object.keys(lower).sort();
  const canonical = keys.map((k) => `${k}:${lower[k]}`).join('\n') + '\n';
  const signed = keys.join(';');
  return [canonical, signed];
}

function volcDate(time: number): string {
  return new Date(time * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

interface SignParams {
  method: string;
  endpoint: string;
  service: string;
  region: string;
  query: Record<string, any>;
  headers: Record<string, string>;
  body: string;
  dateStr: string;
  accessKeyId: string;
  secretAccessKey: string;
  algorithm: string;
}

function volcSign(p: SignParams): string {
  const qs = canonicalQueryString(p.query);
  const [ch, signedHeaders] = canonicalHeaders(p.headers);
  const hashedPayload = createHash('sha256').update(p.body).digest('hex');
  const canonicalRequest = [p.method, '/', qs, ch, signedHeaders, hashedPayload].join('\n');

  const shortDate = p.dateStr.slice(0, 8);
  const credentialScope = `${shortDate}/${p.region}/${p.service}/request`;
  const hashedCanonical = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = p.algorithm + '\n' + p.dateStr + '\n' + credentialScope + '\n' + hashedCanonical;

  const kDate = createHmac('sha256', p.secretAccessKey).update(shortDate).digest();
  const kRegion = createHmac('sha256', kDate).update(p.region).digest();
  const kService = createHmac('sha256', kRegion).update(p.service).digest();
  const kSigning = createHmac('sha256', kService).update('request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${p.algorithm} Credential=${p.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export class HuoshanDeploy implements DeployProvider {
  private logger: ((txt: string) => void) | null = null;
  private AccessKeyId: string;
  private SecretAccessKey: string;

  constructor(config: Record<string, any>) {
    this.AccessKeyId = config.AccessKeyId;
    this.SecretAccessKey = config.SecretAccessKey;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private getCertName(fullchain: string): string {
    let info: { subject: string; validFrom: number };
    try {
      info = parseCertPem(fullchain);
    } catch {
      throw new Error('证书解析失败');
    }
    return info.subject.replaceAll('*.', '') + '-' + info.validFrom;
  }

  private async volcParse(res: Response): Promise<any> {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const err = json && json.ResponseMetadata ? json.ResponseMetadata.Error : null;
    if (res.status === 200) {
      if (err && err.MessageCN) throw new Error(err.MessageCN);
      if (err && err.Message) throw new Error(err.Message);
      if (json && json.Result !== undefined) return json.Result;
      return true;
    }
    if (err && err.MessageCN) throw new Error(err.MessageCN);
    if (err && err.Message) throw new Error(err.Message);
    if (json && json.Message) throw new Error(json.Message);
    if (json && json.message) throw new Error(json.message);
    throw new Error('返回数据解析失败(http_code=' + res.status + ')');
  }

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey) throw new Error('必填参数不能为空');
    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'open.volcengineapi.com', 'cdn', '2021-03-01', 'cn-north-1');
    await client.request('POST', 'ListCertInfo', { Source: 'volc_cert_center' });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product == 'live') {
      await this.deployLive(fullchain, privatekey, config);
      return;
    }
    const certId = await this.getCertId(fullchain, privatekey, config);
    if (!certId) throw new Error('获取证书ID失败');
    info.cert_id = certId;
    if (config.product === undefined || config.product == 'cdn') {
      await this.deployCdn(certId, config);
    } else if (config.product == 'dcdn') {
      await this.deployDcdn(certId, config);
    } else if (config.product == 'tos') {
      await this.deployTos(certId, config);
    } else if (config.product == 'imagex') {
      await this.deployImagex(certId, config);
    } else if (config.product == 'clb') {
      await this.deployClb(certId, config);
    } else if (config.product == 'alb') {
      await this.deployAlb(certId, config);
    } else if (config.product == 'vod') {
      await this.deployVod(certId, config);
    }
  }

  private async deployCdn(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'cdn.volcengineapi.com', 'cdn', '2021-03-01', 'cn-north-1');
    const data = await client.request('POST', 'BatchDeployCert', { CertId: certId, Domain: config.domain });
    if (!data || !data.DeployResult) throw new Error('部署证书失败：DeployResult为空');
    for (const row of data.DeployResult) {
      if (row.Status == 'success') {
        this.log('CDN域名 ' + row.Domain + ' 部署证书成功！');
      } else {
        this.log('CDN域名 ' + row.Domain + ' 部署证书失败：' + (row.ErrorMsg ? row.ErrorMsg : ''));
      }
    }
  }

  private async deployDcdn(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'open.volcengineapi.com', 'dcdn', '2021-04-01', 'cn-north-1');
    await client.request('POST', 'CreateCertBind', {
      CertId: certId,
      DomainNames: String(config.domain).split(','),
    });
    this.log('DCDN域名 ' + config.domain + ' 部署证书成功！');
  }

  private async deployTos(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.bucket_domain) throw new Error('Bucket域名不能为空');
    if (!config.domain) throw new Error('绑定的域名不能为空');
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      const body = JSON.stringify({
        CustomDomainRule: { Domain: domain, CertId: certId },
      });
      const endpoint = config.bucket_domain;
      const time = Math.floor(Date.now() / 1000);
      const dateStr = volcDate(time);
      const headers: Record<string, string> = {
        'Host': endpoint,
        'X-Tos-Date': dateStr,
        'X-Tos-Content-Sha256': createHash('sha256').update(body).digest('hex'),
      };
      headers['Content-Type'] = 'application/json';
      const query = { customdomain: '' };
      headers['Authorization'] = volcSign({
        method: 'PUT',
        endpoint,
        service: 'tos',
        region: 'cn-beijing',
        query,
        headers,
        body,
        dateStr,
        accessKeyId: this.AccessKeyId,
        secretAccessKey: this.SecretAccessKey,
        algorithm: 'TOS4-HMAC-SHA256',
      });
      const url = 'https://' + endpoint + '/?customdomain=';
      const res = await fetch(url, { method: 'PUT', headers, body });
      await this.volcParse(res);
      this.log('对象存储域名 ' + config.domain + ' 部署证书成功！');
    }
  }

  private async deployImagex(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const endpoint = 'imagex.volcengineapi.com';
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      const body = JSON.stringify([{ domain, cert_id: certId }]);
      const time = Math.floor(Date.now() / 1000);
      const dateStr = volcDate(time);
      const query: Record<string, string> = { Action: 'UpdateImageBatchDomainCert', Version: '2018-08-01' };
      const headers: Record<string, string> = { 'Host': endpoint, 'X-Date': dateStr };
      headers['Content-Type'] = 'application/json';
      headers['Authorization'] = volcSign({
        method: 'POST',
        endpoint,
        service: 'imagex',
        region: 'cn-north-1',
        query,
        headers,
        body,
        dateStr,
        accessKeyId: this.AccessKeyId,
        secretAccessKey: this.SecretAccessKey,
        algorithm: 'HMAC-SHA256',
      });
      const url = 'https://' + endpoint + '/?' + new URLSearchParams(query).toString();
      const res = await fetch(url, { method: 'POST', headers, body });
      const result = await this.volcParse(res);
      if (result && result.SuccessDomains && result.SuccessDomains.length > 0) {
        this.log('veImageX域名 ' + domain + ' 部署证书成功！');
      } else if (result && result.FailedDomains && result.FailedDomains.length > 0) {
        const errmsg = result.FailedDomains[0].ErrMsg;
        this.log('veImageX域名 ' + domain + ' 部署证书失败：' + errmsg);
      } else {
        this.log('veImageX域名 ' + domain + ' 部署证书失败');
      }
    }
  }

  private async deployLive(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const certName = this.getCertName(fullchain);

    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'live.volcengineapi.com', 'live', '2023-01-01', 'cn-north-1');
    const param: any = {
      CertName: certName,
      Rsa: { Pubkey: fullchain, Prikey: privatekey },
      UseWay: 'https',
    };
    if (config.project_name) param.ProjectName = config.project_name;
    const result = await client.request('POST', 'CreateCert', param);
    this.log('上传证书成功 ChainID=' + result.ChainID);

    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.request('POST', 'BindCert', {
        ChainID: result.ChainID,
        Domain: domain,
        HTTPS: true,
        HTTP2: true,
      });
      this.log('视频直播域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployVod(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    if (!config.vod_space_name) throw new Error('点播空间名称不能为空');
    if (!config.vod_domain_type) throw new Error('点播域名类型不能为空');

    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'vod.volcengineapi.com', 'vod', '2023-07-01', 'cn-north-1');
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.request('POST', 'UpdateDomainConfig', {
        SpaceName: config.vod_space_name,
        DomainType: config.vod_domain_type,
        Domain: domain,
        Config: {
          HTTPS: {
            Switch: true,
            CertInfo: { CertId: certId },
          },
        },
      });
      this.log('视频点播域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployClb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.listener_id) throw new Error('监听器ID不能为空');
    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'open.volcengineapi.com', 'clb', '2020-04-01', 'cn-beijing');
    await client.request('GET', 'ModifyListenerAttributes', {
      ListenerId: config.listener_id,
      CertificateSource: 'cert_center',
      CertCenterCertificateId: certId,
    });
    this.log('CLB监听器 ' + config.listener_id + ' 部署证书成功！');
  }

  private async deployAlb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.listener_id) throw new Error('监听器ID不能为空');
    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'open.volcengineapi.com', 'alb', '2020-04-01', 'cn-beijing');
    await client.request('GET', 'ModifyListenerAttributes', {
      ListenerId: config.listener_id,
      CertificateSource: 'cert_center',
      CertCenterCertificateId: certId,
    });
    this.log('ALB监听器 ' + config.listener_id + ' 部署证书成功！');
  }

  private async getCertId(fullchain: string, privatekey: string, config: Record<string, any>): Promise<string> {
    const certName = this.getCertName(fullchain);

    const client = new Volcengine(this.AccessKeyId, this.SecretAccessKey, 'certificate-service.volcengineapi.com', 'certificate_service', '2024-10-01', 'cn-beijing');
    const param: any = {
      Tag: certName,
      Repeatable: false,
      CertificateInfo: {
        CertificateChain: fullchain,
        PrivateKey: privatekey,
      },
    };
    if (config.project_name) param.ProjectName = config.project_name;

    let data: any;
    try {
      data = await client.request('POST', 'ImportCertificate', param);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }
    if (data && data.InstanceId) {
      const certId = data.InstanceId;
      this.log('上传证书成功 CertId=' + certId);
      await sleep(1000);
      await client.request('POST', 'CertificateUpdateInstance', {
        InstanceId: certId,
        Options: { ExpiredNotice: 'Disabled' },
      });
      return certId;
    }
    const certId = data.RepeatId;
    this.log('找到已上传的证书 CertId=' + certId);
    return certId;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}