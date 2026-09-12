import { AWS } from '../../clients/AWS.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class AwsDeploy implements DeployProvider {
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

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey) throw new Error('必填参数不能为空');
    const client = new AWS(this.AccessKeyId, this.SecretAccessKey, 'iam.amazonaws.com', 'iam', '2010-05-08', 'us-east-1');
    await client.requestXml('GET', 'GetUser');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product === 'acm') {
      if (!config.acm_arn) throw new Error('ACM ARN不能为空');
      await this.getCertId(fullchain, privatekey, config.acm_arn, true, info);
    } else {
      await this.deployCloudfront(fullchain, privatekey, config, info);
    }
  }

  private async deployCloudfront(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.distribution_id) throw new Error('分配ID不能为空');
    if (!parseCertPem(fullchain)) throw new Error('证书解析失败');

    const certId = await this.getCertId(fullchain, privatekey, info.cert_id || null, false, info);
    await new Promise((r) => setTimeout(r, 500));

    const client = new AWS(this.AccessKeyId, this.SecretAccessKey, 'cloudfront.amazonaws.com', 'cloudfront', '2020-05-31', 'us-east-1');
    let data: any;
    try {
      data = await client.requestXmlN('GET', '/distribution/' + config.distribution_id + '/config', [], undefined, true);
    } catch (e: any) {
      throw new Error('获取分配信息失败：' + e.message);
    }

    data.ViewerCertificate.ACMCertificateArn = certId;
    data.ViewerCertificate.CloudFrontDefaultCertificate = 'false';
    delete data.ViewerCertificate.Certificate;
    delete data.ViewerCertificate.CertificateSource;

    await client.requestXmlN('PUT', '/distribution/' + config.distribution_id + '/config', data, 'DistributionConfig xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"');
    this.log('分配ID: ' + config.distribution_id + ' 证书部署成功！');
  }

  private async getCertId(fullchain: string, privatekey: string, certId: string | null, acm: boolean, info: any): Promise<string> {
    if (acm && certId == null) {
      throw new Error('ACM ARN不能为空');
    }

    const certificates = fullchain.split('-----END CERTIFICATE-----');
    const cert = certificates[0] + '-----END CERTIFICATE-----';

    const client = new AWS(this.AccessKeyId, this.SecretAccessKey, 'acm.us-east-1.amazonaws.com', 'acm', '', 'us-east-1');

    if (certId) {
      try {
        const data = await client.request('POST', 'CertificateManager.GetCertificate', {
          CertificateArn: certId,
        });
        if (data.Certificate !== undefined && String(data.Certificate).trim() === String(cert).trim()) {
          this.log('证书已是最新，ACM ARN：' + certId);
          return certId;
        }
        this.log('证书已过期或被删除，准备更新或者重新上传');
      } catch (e: any) {
        if (acm) {
          throw new Error('获取证书信息失败，请检查ACM ARN是否正确：' + e.message);
        }
        this.log('证书已被删除：' + certId + '，准备重新上传');
      }
    }

    let certificateChain = '';
    if (certificates.length > 1) {
      for (let i = 1; i < certificates.length; i++) {
        if (certificates[i].trim() !== '') {
          certificateChain += certificates[i] + '-----END CERTIFICATE-----';
        }
      }
    }

    const param: Record<string, any> = {
      Certificate: Buffer.from(cert).toString('base64'),
      PrivateKey: Buffer.from(privatekey).toString('base64'),
    };
    if (certificateChain) {
      param.CertificateChain = Buffer.from(certificateChain).toString('base64');
    }
    if (acm) {
      param.CertificateArn = certId;
    }

    let resultCertId: string;
    try {
      const data = await client.request('POST', 'CertificateManager.ImportCertificate', param);
      resultCertId = data.CertificateArn;
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }

    this.log('证书上传成功：' + resultCertId);
    info.cert_id = resultCertId;
    return resultCertId;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}