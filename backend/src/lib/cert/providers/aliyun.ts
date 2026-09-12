import { Aliyun } from '../../clients/Aliyun.js';
import { getMainDomain, parseCertPem } from '../utils.js';
import type { CertProvider, CreateOrderResult, CertInfo } from '../types.js';

export class AliyunCert implements CertProvider {
  private client: Aliyun;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>, _ext: any = null) {
    this.client = new Aliyun(config.AccessKeyId, config.AccessKeySecret, 'cas.aliyuncs.com', '2020-04-07');
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async request(param: Record<string, any>, returnData = false): Promise<any> {
    this.log('Request:' + JSON.stringify(param));
    const result = await this.client.request(param, 'POST');
    const response = JSON.stringify(result);
    if (!response.includes('"Type":"certificate"')) {
      this.log('Response:' + response);
    }
    return returnData ? result : true;
  }

  async register() {
    await this.request({ Action: 'ListInstances' }, true);
    return true;
  }

  async buyCert(_domainList: string[]): Promise<any> {
    const data = await this.request({ Action: 'GetInstanceSummary', InstanceType: 'TEST' }, true);
    if (!data.InactiveCount || data.InactiveCount == 0) throw new Error('没有待使用的测试证书实例，请先购买测试证书');
    this.log('实例总个数:' + data.TotalCount + ',实例待使用总数:' + data.InactiveCount);
    return data;
  }

  async createOrder(domainList: string[], keytype: string, keysize: string, _order?: any): Promise<CreateOrderResult> {
    if (!domainList.length) throw new Error('域名列表不能为空');
    const domain = domainList[0];

    let data = await this.request({ Action: 'ListInstances', Status: 'inactive', InstanceType: 'TEST' }, true);
    if (!data.InstanceList?.length) throw new Error('待使用的测试证书实例列表为空');
    const instanceId = data.InstanceList[0].InstanceId;

    data = await this.request({ Action: 'ListContact' }, true);
    if (!data.ContactList?.length) throw new Error('联系人列表为空，请先添加联系人');
    const contactId = data.ContactList[0].ContactId;

    const keyAlgorithm = keytype === 'ECC' ? 'ECC_256' : keysize === '3072' ? 'RSA_3072' : 'RSA_2048';
    await this.request({
      Action: 'UpdateInstance',
      InstanceId: instanceId,
      Domain: domain,
      KeyAlgorithm: keyAlgorithm,
      AutoReissue: 'disable',
      'ContactIdList.1': contactId,
      ValidateType: 'DNS',
    });

    await this.request({ Action: 'ApplyCertificate', InstanceId: instanceId });

    await new Promise((r) => setTimeout(r, 1000));

    let status = '';
    do {
      data = await this.request({ Action: 'GetTaskAttribute', TaskId: instanceId }, true);
      status = data.TaskStatus;
      if (status === 'processing') {
        await new Promise((r) => setTimeout(r, 1000));
      } else if (status === 'failed') {
        throw new Error('申请证书失败：' + data.TaskMessage);
      }
    } while (status === 'processing');

    data = await this.request({ Action: 'GetInstanceDetail', InstanceId: instanceId }, true);
    const order: any = { InstanceId: instanceId };

    const dnsList: Record<string, any[]> = {};
    for (const opts of data.DomainValidationList || []) {
      const mainDomain = await getMainDomain(opts.Domain);
      const fullKey = (opts.ValidationKey || '') + '.' + (opts.RootDomain || '');
      const name = fullKey.slice(0, -(mainDomain.length + 1));
      if (!dnsList[mainDomain]) dnsList[mainDomain] = [];
      dnsList[mainDomain].push({ name, type: opts.ValidationType, value: opts.ValidationValue });
    }
    return { dnsList, order };
  }

  async authOrder(_domainList: string[], _order: any): Promise<void> {
    return;
  }

  async getAuthStatus(_domainList: string[], order: any): Promise<boolean> {
    const data = await this.request({ Action: 'GetInstanceDetail', InstanceId: order.InstanceId }, true);
    if (data.Status === 'normal') return true;
    if (data.Status === 'closed') throw new Error('证书审核失败');
    return false;
  }

  async finalizeOrder(_domainList: string[], order: any, _keytype: string, _keysize: string): Promise<CertInfo> {
    let data = await this.request({ Action: 'GetInstanceDetail', InstanceId: order.InstanceId }, true);
    if (!data.CertificateId) throw new Error('证书ID不存在');

    data = await this.request({ Action: 'GetUserCertificateDetail', CertId: data.CertificateId }, true);
    const fullchain = data.Cert;
    const private_key = data.Key;
    if (!fullchain || !private_key) throw new Error('证书内容获取失败');

    const certInfo = parseCertPem(fullchain);
    return {
      private_key,
      fullchain,
      issuer: certInfo.issuer,
      subject: certInfo.subject,
      validFrom: certInfo.validFrom,
      validTo: certInfo.validTo,
    };
  }

  async revoke(order: any, _pem: string): Promise<void> {
    await this.request({ Action: 'RevokeCertificate', InstanceId: order.InstanceId });
  }

  async cancel(order: any): Promise<void> {
    const data = await this.request({ Action: 'GetInstanceDetail', InstanceId: order.InstanceId }, true);
    if (data.Status === 'pending') {
      await this.request({ Action: 'CancelPendingCertificate', InstanceId: order.InstanceId });
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}