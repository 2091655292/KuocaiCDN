import { createHash, createHmac } from 'node:crypto';
import { HuaweiCloud } from '../../clients/HuaweiCloud.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class HuaweiDeploy implements DeployProvider {
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

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey) throw new Error('必填参数不能为空');
    const client = new HuaweiCloud(this.AccessKeyId, this.SecretAccessKey, 'scm.cn-north-4.myhuaweicloud.com');
    await client.request('GET', '/v3/scm/certificates');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    config.cert_name = this.getCertName(fullchain);
    if (config.product == 'cdn') {
      await this.deployCdn(fullchain, privatekey, config);
    } else if (config.product == 'elb') {
      await this.deployElb(fullchain, privatekey, config);
    } else if (config.product == 'waf') {
      await this.deployWaf(fullchain, privatekey, config);
    } else if (config.product == 'obs') {
      await this.deployObs(fullchain, privatekey, config);
    } else if (config.product == 'upload') {
      const certId = await this.getCertId(fullchain, privatekey);
      info.cert_id = certId;
    }
  }

  private async deployCdn(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    const client = new HuaweiCloud(this.AccessKeyId, this.SecretAccessKey, 'cdn.myhuaweicloud.com');
    const param = {
      configs: {
        https: {
          https_status: 'on',
          certificate_type: 'server',
          certificate_source: 0,
          certificate_name: config.cert_name,
          certificate_value: fullchain,
          private_key: privatekey,
        },
      },
    };
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.request('PUT', '/v1.1/cdn/configuration/domains/' + domain + '/configs', null, param);
      this.log('CDN域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployElb(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.project_id) throw new Error('项目ID不能为空');
    if (!config.region_id) throw new Error('区域ID不能为空');
    if (!config.cert_id) throw new Error('证书ID不能为空');
    const endpoint = 'elb.' + config.region_id + '.myhuaweicloud.com';
    const client = new HuaweiCloud(this.AccessKeyId, this.SecretAccessKey, endpoint);
    let data: any;
    try {
      data = await client.request('GET', '/v3/' + config.project_id + '/elb/certificates/' + config.cert_id);
    } catch (e: any) {
      throw new Error('证书详情查询失败：' + e.message);
    }
    if (data && data.certificate && data.certificate.certificate && data.certificate.certificate.trim() == fullchain.trim()) {
      this.log('ELB证书ID ' + config.cert_id + ' 已存在，无需重复部署');
      return;
    }
    const param = {
      certificate: {
        certificate: fullchain,
        private_key: privatekey,
        domain: (config.domainList || []).join(','),
      },
    };
    await client.request('PUT', '/v3/' + config.project_id + '/elb/certificates/' + config.cert_id, null, param);
    this.log('ELB证书ID ' + config.cert_id + ' 更新证书成功！');
  }

  private async deployWaf(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.project_id) throw new Error('项目ID不能为空');
    if (!config.region_id) throw new Error('区域ID不能为空');
    if (!config.cert_id) throw new Error('证书ID不能为空');
    const endpoint = 'waf.' + config.region_id + '.myhuaweicloud.com';
    const client = new HuaweiCloud(this.AccessKeyId, this.SecretAccessKey, endpoint);
    let data: any;
    try {
      data = await client.request('GET', '/v1/' + config.project_id + '/waf/certificates/' + config.cert_id);
    } catch (e: any) {
      throw new Error('证书详情查询失败：' + e.message);
    }
    if (data && data.content && data.content.trim() == fullchain.trim()) {
      this.log('WAF证书ID ' + config.cert_id + ' 已存在，无需重复部署');
      return;
    }
    const param = {
      name: config.cert_name,
      content: fullchain,
      key: privatekey,
    };
    await client.request('PUT', '/v1/' + config.project_id + '/waf/certificates/' + config.cert_id, null, param);
    this.log('WAF证书ID ' + config.cert_id + ' 更新证书成功！');
  }

  private async deployObs(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    if (!config.obs_endpoint) throw new Error('OBS Endpoint不能为空');
    if (!config.obs_bucket) throw new Error('OBS 桶名称不能为空');
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await this.obsSetBucketCustomdomain(config.obs_bucket, config.obs_endpoint, domain, config.cert_name, fullchain, privatekey);
      this.log('OSS域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async obsSetBucketCustomdomain(
    bucket: string,
    endpoint: string,
    domain: string,
    certName: string,
    fullchain: string,
    privatekey: string,
  ): Promise<void> {
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<CustomDomainConfiguration>' +
      '<Name>' + escapeXml(certName) + '</Name>' +
      '<Certificate>' + escapeXml(fullchain) + '</Certificate>' +
      '<PrivateKey>' + escapeXml(privatekey) + '</PrivateKey>' +
      '</CustomDomainConfiguration>';

    const hostname = bucket + '.' + endpoint;
    const date = new Date().toUTCString();
    const contentType = 'application/xml';
    const contentMd5 = createHash('md5').update(body, 'utf8').digest('base64');

    const resourcePath = '/' + bucket + '/';
    const canonicalizedResource = resourcePath + '?customdomain=' + domain;
    const stringToSign = 'PUT\n' + contentMd5 + '\n' + contentType + '\n' + date + '\n' + canonicalizedResource;
    const signature = createHmac('sha1', this.SecretAccessKey).update(stringToSign).digest('base64');
    const authorization = 'OBS ' + this.AccessKeyId + ':' + signature;

    const url = 'https://' + hostname + '/?customdomain=' + encodeURIComponent(domain);
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-MD5': contentMd5,
        'Date': date,
        'Authorization': authorization,
      },
      body,
    });
    if (res.status >= 200 && res.status < 300) return;
    throw new Error('HTTP Code: ' + res.status);
  }

  private async getCertId(fullchain: string, privatekey: string): Promise<string> {
    const certName = this.getCertName(fullchain);
    const client = new HuaweiCloud(this.AccessKeyId, this.SecretAccessKey, 'scm.cn-north-4.myhuaweicloud.com');
    const param = {
      name: certName,
      certificate: fullchain,
      private_key: privatekey,
    };
    let data: any;
    try {
      data = await client.request('POST', '/v3/scm/certificates/import', null, param);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }
    this.log('上传证书成功 certificate_id=' + data.certificate_id);
    return data.certificate_id;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}