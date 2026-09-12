import { BaiduCloud } from '../../clients/BaiduCloud.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class BaiduDeploy implements DeployProvider {
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
    const client = new BaiduCloud(this.AccessKeyId, this.SecretAccessKey, 'cdn.baidubce.com');
    await client.request('GET', '/v2/domain');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product === undefined || config.product == 'cdn') {
      await this.deployCdn(fullchain, privatekey, config, info);
    } else {
      const certId = await this.getCertId(fullchain, privatekey);
      info.cert_id = certId;
      if (config.product == 'blb') {
        await this.deployBlb(certId, config);
      } else if (config.product == 'appblb') {
        await this.deployAppblb(certId, config);
      } else if (config.product == 'upload') {
      } else {
        throw new Error('不支持的产品类型');
      }
    }
  }

  private async deployCdn(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.domain) throw new Error('绑定的域名不能为空');
    config.cert_name = this.getCertName(fullchain);

    const client = new BaiduCloud(this.AccessKeyId, this.SecretAccessKey, 'cdn.baidubce.com');
    const param = {
      httpsEnable: 'ON',
      certificate: {
        certName: config.cert_name,
        certServerData: fullchain,
        certPrivateData: privatekey,
      },
    };
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      try {
        const data = await client.request('GET', '/v2/' + domain + '/certificates');
        if (data && data.certName && data.certName == config.cert_name) {
          this.log('CDN域名 ' + domain + ' 证书已存在，无需重复部署');
          return;
        }
      } catch (e: any) {
        this.log(e.message);
      }

      const data = await client.request('PUT', '/v2/' + domain + '/certificates', null, param);
      info.cert_id = data.certId;
      this.log('CDN域名 ' + domain + ' 证书部署成功！');
    }
  }

  private async deployBlb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.blb_id) throw new Error('负载均衡实例ID不能为空');
    if (!config.blb_port) throw new Error('HTTPS监听端口不能为空');
    const client = new BaiduCloud(this.AccessKeyId, this.SecretAccessKey, 'blb.' + config.region + '.baidubce.com');
    const query = { listenerPort: config.blb_port };
    const param = { certIds: [certId] };
    await client.request('PUT', '/v1/blb/' + config.blb_id + '/HTTPSlistener', query, param);
    this.log('普通型BLB ' + config.blb_id + ' 部署证书成功！');
  }

  private async deployAppblb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.blb_id) throw new Error('负载均衡实例ID不能为空');
    if (!config.blb_port) throw new Error('HTTPS监听端口不能为空');
    const client = new BaiduCloud(this.AccessKeyId, this.SecretAccessKey, 'blb.' + config.region + '.baidubce.com');
    const query = { listenerPort: config.blb_port };
    const param = { certIds: [certId] };
    await client.request('PUT', '/v1/appblb/' + config.blb_id + '/HTTPSlistener', query, param);
    this.log('应用型BLB ' + config.blb_id + ' 部署证书成功！');
  }

  private async getCertId(fullchain: string, privatekey: string): Promise<string> {
    const certName = this.getCertName(fullchain);
    const client = new BaiduCloud(this.AccessKeyId, this.SecretAccessKey, 'certificate.baidubce.com');
    const query = { certName };
    let data: any;
    try {
      data = await client.request('GET', '/v1/certificate', query);
    } catch (e: any) {
      throw new Error('查找证书失败：' + e.message);
    }
    for (const row of data.certs || []) {
      if (row.certName == certName) {
        this.log('证书已存在 CertId=' + row.certId);
        return row.certId;
      }
    }

    const param = {
      certName,
      certServerData: fullchain,
      certPrivateData: privatekey,
    };
    try {
      data = await client.request('POST', '/v1/certificate', null, param);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }
    const certId = data.certId;
    this.log('上传证书成功 CertId=' + certId);
    return certId;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}