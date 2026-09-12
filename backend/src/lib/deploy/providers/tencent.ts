import { TencentCloud } from '../../clients/TencentCloud.js';
import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TencentDeploy implements DeployProvider {
  private SecretId: string;
  private SecretKey: string;
  private client: TencentCloud;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.SecretId = config.SecretId || '';
    this.SecretKey = config.SecretKey || '';
    this.client = new TencentCloud(this.SecretId, this.SecretKey, 'ssl.tencentcloudapi.com', 'ssl', '2019-12-05');
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private makeClient(endpoint: string, service: string, region?: string): TencentCloud {
    return new TencentCloud(this.SecretId, this.SecretKey, endpoint, service, '2019-12-05', region);
  }

  async check(): Promise<void> {
    if (!this.SecretId || !this.SecretKey) throw new Error('必填参数不能为空');
    await this.client.request('DescribeCertificates', {});
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product === 'update') {
      return await this.updateCert(fullchain, privatekey, config);
    }
    if (config.product === 'update_new') {
      return await this.updateCertNew(fullchain, privatekey, config, info);
    }
    const certId = await this.getCertId(fullchain, privatekey);
    if (!certId) throw new Error('证书ID获取失败');
    info.cert_id = certId;

    let instanceId = '';
    if (config.product === 'cos') {
      if (!config.regionid) throw new Error('所属地域ID不能为空');
      if (!config.cos_bucket) throw new Error('存储桶名称不能为空');
      if (!config.domain) throw new Error('绑定的域名不能为空');
      instanceId = config.regionid + '|' + config.cos_bucket + '|' + config.domain;
      this.client = this.makeClient('ssl.tencentcloudapi.com', 'ssl', config.regionid);
    } else if (config.product === 'tke') {
      if (!config.regionid) throw new Error('所属地域ID不能为空');
      if (!config.tke_cluster_id) throw new Error('集群ID不能为空');
      if (!config.tke_namespace) throw new Error('命名空间不能为空');
      if (!config.tke_secret) throw new Error('secret名称不能为空');
      instanceId = config.tke_cluster_id + '|' + config.tke_namespace + '|' + config.tke_secret;
      this.client = this.makeClient('ssl.tencentcloudapi.com', 'ssl', config.regionid);
    } else if (config.product === 'lighthouse') {
      if (!config.regionid) throw new Error('所属地域ID不能为空');
      if (!config.lighthouse_id) throw new Error('实例ID不能为空');
      if (!config.domain) throw new Error('绑定的域名不能为空');
      instanceId = config.regionid + '|' + config.lighthouse_id + '|' + config.domain;
      this.client = this.makeClient('ssl.tencentcloudapi.com', 'ssl', config.regionid);
    } else if (config.product === 'ddos') {
      if (!config.lighthouse_id) throw new Error('实例ID不能为空');
      if (!config.domain) throw new Error('绑定的域名不能为空');
      instanceId = config.lighthouse_id + '|' + config.domain + '|443';
    } else if (config.product === 'clb') {
      return await this.deployClb(certId, config);
    } else if (config.product === 'scf') {
      return await this.deployScf(certId, config);
    } else if (config.product === 'teo' && config.site_id) {
      return await this.deployTeo(certId, config);
    } else if (config.product === 'upload') {
      return;
    } else {
      if (!config.domain) throw new Error('绑定的域名不能为空');
      if (config.product === 'waf') {
        this.client = this.makeClient('ssl.tencentcloudapi.com', 'ssl', config.region);
      } else if (['tse', 'scf'].includes(config.product)) {
        if (!config.regionid) throw new Error('所属地域ID不能为空');
        this.client = this.makeClient('ssl.tencentcloudapi.com', 'ssl', config.regionid);
      }
      instanceId = config.domain;
    }
    try {
      const recordId = await this.deployCommon(config.product, certId, instanceId);
      info.record_id = recordId;
    } catch (e: any) {
      if (info.record_id) {
        if (await this.deployQuery(info.record_id)) {
          this.log(config.product.toUpperCase() + '实例 ' + instanceId + ' 已部署证书，无需重复部署');
          return;
        }
      }
      throw e;
    }
  }

  private async getCertId(fullchain: string, privatekey: string): Promise<string> {
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const param = {
      CertificatePublicKey: fullchain,
      CertificatePrivateKey: privatekey,
      CertificateType: 'SVR',
      Alias: certName,
      Repeatable: false,
    };
    let data: any;
    try {
      data = await this.client.request('UploadCertificate', param);
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }
    this.log('上传证书成功 CertificateId=' + data.CertificateId);
    await sleep(300);

    await this.client.request('ModifyCertificatesExpiringNotificationSwitch', {
      CertificateIds: [data.CertificateId],
      SwitchStatus: 1,
    });

    return data.CertificateId;
  }

  private async deployCommon(product: string, certId: string, instanceId: string): Promise<string> {
    let instanceIds: string[];
    if (['cdn', 'waf', 'teo', 'ddos', 'live', 'vod'].includes(product) && String(instanceId).includes(',')) {
      instanceIds = String(instanceId).split(',');
    } else {
      instanceIds = [instanceId];
    }
    if (product === 'cdn') {
      instanceIds = instanceIds.map((id) => id + '|on');
    }
    const param: Record<string, any> = {
      CertificateId: certId,
      InstanceIdList: instanceIds,
      ResourceType: product,
    };
    if (product === 'live') param.Status = 1;
    const data = await this.client.request('DeployCertificateInstance', param);
    this.log(JSON.stringify(data));
    this.log(product.toUpperCase() + '实例 ' + instanceId + ' 部署证书成功！');
    return data.DeployRecordId;
  }

  private async deployQuery(recordId: string): Promise<boolean> {
    const param = { DeployRecordId: String(recordId) };
    try {
      const data = await this.client.request('DescribeHostDeployRecordDetail', param);
      if ((data.SuccessTotalCount && data.SuccessTotalCount >= 1) || (data.RunningTotalCount && data.RunningTotalCount >= 1)) {
        return true;
      }
      if (data.FailedTotalCount && data.FailedTotalCount >= 1 && data.DeployRecordDetailList && data.DeployRecordDetailList.length > 0) {
        let errmsg = data.DeployRecordDetailList[0].ErrorMsg;
        if (errmsg && errmsg.includes('\\u')) {
          try {
            errmsg = JSON.parse(errmsg);
          } catch {
            // ignore
          }
        }
        this.log('证书部署失败原因：' + errmsg);
      }
    } catch (e: any) {
      this.log('查询证书部署记录失败：' + e.message);
    }
    return false;
  }

  private async deployClb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.regionid) throw new Error('所属地域ID不能为空');
    if (!config.clb_id) throw new Error('负载均衡ID不能为空');
    const sniSwitch = config.clb_domain ? 1 : 0;

    const client = new TencentCloud(this.SecretId, this.SecretKey, 'clb.tencentcloudapi.com', 'clb', '2018-03-17', config.regionid);
    const param: Record<string, any> = {
      LoadBalancerId: config.clb_id,
      Protocol: 'HTTPS',
    };
    if (config.clb_listener_id) {
      param.ListenerIds = [config.clb_listener_id];
    }
    let data: any;
    try {
      data = await client.request('DescribeListeners', param);
    } catch (e: any) {
      throw new Error('获取监听器列表失败：' + e.message);
    }
    if (!data.TotalCount || data.TotalCount === 0) throw new Error('负载均衡:' + config.clb_id + '监听器列表为空');
    let count = 0;
    for (const listener of data.Listeners || []) {
      if (listener.SniSwitch === sniSwitch) {
        if (sniSwitch === 1) {
          for (const rule of listener.Rules || []) {
            if (rule.Domain === config.clb_domain) {
              if (rule.Certificate && rule.Certificate.CertId === certId) {
                this.log('负载均衡监听器 ' + listener.ListenerId + ' 域名 ' + rule.Domain + ' 已部署证书，无需重复部署');
              } else {
                await client.request('ModifyDomainAttributes', {
                  LoadBalancerId: config.clb_id,
                  ListenerId: listener.ListenerId,
                  Domain: rule.Domain,
                  Certificate: {
                    SSLMode: 'UNIDIRECTIONAL',
                    CertId: certId,
                  },
                });
                this.log('负载均衡监听器 ' + listener.ListenerId + ' 域名 ' + rule.Domain + ' 部署证书成功！');
              }
              count++;
            }
          }
        } else {
          if (listener.Certificate && listener.Certificate.CertId === certId) {
            this.log('负载均衡监听器 ' + listener.ListenerId + ' 已部署证书，无需重复部署');
          } else {
            await client.request('ModifyListener', {
              LoadBalancerId: config.clb_id,
              ListenerId: listener.ListenerId,
              Certificate: {
                SSLMode: 'UNIDIRECTIONAL',
                CertId: certId,
              },
            });
            this.log('负载均衡监听器 ' + listener.ListenerId + ' 部署证书成功！');
          }
          count++;
        }
      }
    }
    if (count === 0) throw new Error('没有找到要更新证书的监听器');
  }

  private async deployScf(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.regionid) throw new Error('所属地域ID不能为空');
    if (!config.domain) throw new Error('绑定的域名不能为空');

    const client = new TencentCloud(this.SecretId, this.SecretKey, 'scf.tencentcloudapi.com', 'scf', '2018-04-16', config.regionid);
    let data: any;
    try {
      data = await client.request('GetCustomDomain', { Domain: config.domain });
    } catch (e: any) {
      throw new Error('获取云函数自定义域名失败：' + e.message);
    }

    if (data.CertConfig && data.CertConfig.CertificateId === certId) {
      this.log('云函数自定义域名 ' + config.domain + ' 已部署证书，无需重复部署');
      return;
    }
    data.CertConfig.CertificateId = certId;
    if (data.Protocol === 'HTTP') data.Protocol = 'HTTP&HTTPS';

    await client.request('UpdateCustomDomain', {
      Domain: config.domain,
      Protocol: data.Protocol,
      CertConfig: data.CertConfig,
    });
    this.log('云函数自定义域名 ' + config.domain + ' 部署证书成功！');
  }

  private async deployTeo(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.site_id) throw new Error('站点ID不能为空');
    if (!config.domain) throw new Error('绑定的域名不能为空');

    const endpoint = config.site_type === 'intl' ? 'teo.intl.tencentcloudapi.com' : 'teo.tencentcloudapi.com';
    const client = new TencentCloud(this.SecretId, this.SecretKey, endpoint, 'teo', '2022-09-01');
    const hosts = String(config.domain).split(',');
    await client.request('ModifyHostsCertificate', {
      ZoneId: config.site_id,
      Hosts: hosts,
      Mode: 'sslcert',
      ServerCertInfo: [{ CertId: certId }],
    });
    this.log('边缘安全加速域名 ' + config.domain + ' 部署证书成功！');
  }

  private async updateCert(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.cert_id) throw new Error('证书ID不能为空');

    let data: any;
    try {
      data = await this.client.request('CreateCertificateBindResourceSyncTask', {
        CertificateIds: [config.cert_id],
        IsCache: 1,
      });
      if (!data.CertTaskIds || data.CertTaskIds.length === 0) throw new Error('返回任务ID为空');
    } catch (e: any) {
      throw new Error('创建关联云资源查询任务失败：' + e.message);
    }
    const taskId = data.CertTaskIds[0].TaskId;
    this.log('创建关联云资源查询任务成功 TaskId=' + taskId);

    let resourceResult: any = null;
    let retry = 0;
    while (retry++ < 30) {
      await sleep(2000);
      try {
        data = await this.client.request('DescribeCertificateBindResourceTaskResult', { TaskIds: [taskId] });
        if (!data.SyncTaskBindResourceResult || data.SyncTaskBindResourceResult.length === 0) throw new Error('返回结果为空');
      } catch (e: any) {
        throw new Error('查询关联云资源任务结果失败：' + e.message);
      }
      const taskResult = data.SyncTaskBindResourceResult[0];
      if (taskResult.Status === 1) {
        resourceResult = taskResult.BindResourceResult;
        break;
      } else if (taskResult.Status === 2) {
        throw new Error('关联云资源查询任务执行失败：' + (taskResult.Error ? taskResult.Error.Message : '未知错误'));
      }
    }
    if (!resourceResult) {
      throw new Error('关联云资源查询任务超时未完成，请稍后重试');
    }

    const resourceTypes: string[] = [];
    const resourceTypesRegions: any[] = [];
    for (const res of resourceResult || []) {
      if (res.ResourceType !== 'clb') continue;
      let totalCount = 0;
      const regions: string[] = [];
      for (const regionRes of res.BindResourceRegionResult || []) {
        if (regionRes.TotalCount > 0) {
          totalCount += regionRes.TotalCount;
          if (regionRes.Region) regions.push(regionRes.Region);
        }
      }
      if (totalCount > 0) {
        resourceTypes.push(res.ResourceType);
        if (regions.length > 0) {
          resourceTypesRegions.push({ ResourceType: res.ResourceType, Regions: regions });
        }
      }
    }

    const param: Record<string, any> = {
      OldCertificateId: config.cert_id,
      CertificatePublicKey: fullchain,
      CertificatePrivateKey: privatekey,
      ResourceTypes: resourceTypes,
      ResourceTypesRegions: resourceTypesRegions,
    };
    retry = 0;
    while (retry++ < 10) {
      try {
        data = await this.client.request('UploadUpdateCertificateInstance', param);
      } catch (e: any) {
        throw new Error('更新证书内容失败：' + e.message);
      }
      if (data.DeployStatus === 1) {
        break;
      }
      await sleep(1000);
    }
    this.log('更新证书内容成功，可能需要一些时间完成各资源的证书更新部署');
  }

  private async updateCertNew(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (!config.cert_id) throw new Error('证书ID不能为空');

    const oldCertId = config.cert_id;

    let data: any;
    try {
      data = await this.client.request('CreateCertificateBindResourceSyncTask', {
        CertificateIds: [oldCertId],
        IsCache: 1,
      });
      if (!data.CertTaskIds || data.CertTaskIds.length === 0) throw new Error('返回任务ID为空');
    } catch (e: any) {
      throw new Error('创建关联云资源查询任务失败：' + e.message);
    }
    const taskId = data.CertTaskIds[0].TaskId;
    this.log('创建关联云资源查询任务成功 TaskId=' + taskId);

    let resourceResult: any = null;
    let retry = 0;
    while (retry++ < 60) {
      await sleep(2000);
      try {
        data = await this.client.request('DescribeCertificateBindResourceTaskResult', { TaskIds: [taskId] });
        if (!data.SyncTaskBindResourceResult || data.SyncTaskBindResourceResult.length === 0) throw new Error('返回结果为空');
      } catch (e: any) {
        throw new Error('查询关联云资源任务结果失败：' + e.message);
      }
      const taskResult = data.SyncTaskBindResourceResult[0];
      this.log('查询关联云资源结果轮询中... 第' + retry + '次，状态=' + taskResult.Status);
      if (taskResult.Status === 1) {
        resourceResult = taskResult.BindResourceResult;
        break;
      } else if (taskResult.Status === 2) {
        throw new Error('关联云资源查询任务执行失败：' + (taskResult.Error ? taskResult.Error.Message : '未知错误'));
      }
    }
    if (!resourceResult) {
      this.log('关联云资源查询任务超时（120秒），将跳过资源查询，仅上传新证书');
    }

    const regionTypes = ['clb', 'tke', 'apigateway', 'waf', 'tcb', 'tse', 'cos', 'mqtt', 'scf', 'tdmq'];

    const resourceTypes: string[] = [];
    const resourceTypesRegions: any[] = [];
    if (resourceResult) {
      for (const res of resourceResult) {
        let totalCount = 0;
        const regions: string[] = [];
        for (const regionRes of res.BindResourceRegionResult || []) {
          if (regionRes.TotalCount > 0) {
            totalCount += regionRes.TotalCount;
            if (regionRes.Region) regions.push(regionRes.Region);
          }
        }
        if (totalCount > 0) {
          resourceTypes.push(res.ResourceType);
          if (regionTypes.includes(res.ResourceType) && regions.length > 0) {
            resourceTypesRegions.push({ ResourceType: res.ResourceType, Regions: regions });
          }
        }
      }
    }

    if (resourceTypes.length === 0) {
      this.log('未检测到该证书关联的云资源实例，将仅上传新证书');
      let newCertId: string | null = null;
      try {
        const certInfo = parseCertPem(fullchain);
        if (!certInfo) throw new Error('证书解析失败');
        const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
        data = await this.client.request('UploadCertificate', {
          CertificatePublicKey: fullchain,
          CertificatePrivateKey: privatekey,
          CertificateType: 'SVR',
          Alias: certName,
          Repeatable: true,
          AllowDownload: true,
        });
        newCertId = data.CertificateId;
        this.log('新证书上传成功 CertificateId=' + newCertId);
        if (!info.config) info.config = {};
        info.config.cert_id = newCertId;
        this.log('证书ID已更新为：' + newCertId);

        await sleep(300);
        await this.client.request('ModifyCertificatesExpiringNotificationSwitch', {
          CertificateIds: [newCertId],
          SwitchStatus: 1,
        });
      } catch (e: any) {
        this.log('上传新证书失败：' + e.message);
      }

      if (config.delete_old_cert) {
        if (newCertId && newCertId === oldCertId) {
          this.log('新证书ID与旧证书ID相同（证书内容未变），跳过删除');
        } else {
          try {
            await this.client.request('DeleteCertificate', { CertificateId: oldCertId });
            this.log('旧证书 ' + oldCertId + ' 已从腾讯云删除');
          } catch (e: any) {
            this.log('删除旧证书 ' + oldCertId + ' 失败：' + e.message);
          }
        }
      }
      return;
    }

    this.log('发现关联云资源类型：' + resourceTypes.join(', '));

    const param: Record<string, any> = {
      OldCertificateId: oldCertId,
      CertificatePublicKey: fullchain,
      CertificatePrivateKey: privatekey,
      ResourceTypes: resourceTypes,
    };
    if (resourceTypesRegions.length > 0) {
      param.ResourceTypesRegions = resourceTypesRegions;
    }

    this.log('UpdateCertificateInstance 请求参数(已隐藏证书内容)：' + JSON.stringify({ ...param, CertificatePublicKey: '***', CertificatePrivateKey: '***' }));

    let newCertId: string | null = null;
    retry = 0;
    while (retry++ < 10) {
      try {
        data = await this.client.request('UpdateCertificateInstance', param);
      } catch (e: any) {
        throw new Error('一键更新旧证书资源失败：' + e.message);
      }
      if (data.DeployRecordId && data.DeployRecordId > 0) {
        this.log('一键更新任务创建成功 DeployRecordId=' + data.DeployRecordId);
        newCertId = await this.findNewCertId(fullchain);
        break;
      }
      await sleep(2000);
    }

    if (newCertId) {
      if (!info.config) info.config = {};
      info.config.cert_id = newCertId;
      this.log('证书ID已更新为：' + newCertId);
    }

    if (config.delete_old_cert) {
      if (newCertId && newCertId === oldCertId) {
        this.log('新证书ID与旧证书ID相同（证书内容未变），跳过删除');
      } else {
        try {
          await this.client.request('DeleteCertificate', { CertificateId: oldCertId });
          this.log('旧证书 ' + oldCertId + ' 已从腾讯云删除');
        } catch (e: any) {
          this.log('删除旧证书 ' + oldCertId + ' 失败：' + e.message);
        }
      }
    }

    this.log('一键更新旧证书资源已提交，可能需要一些时间完成各资源的证书更新部署');
  }

  private async findNewCertId(fullchain: string): Promise<string | null> {
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) return null;
    const cn = certInfo.subject || '';
    if (!cn) return null;

    try {
      const data = await this.client.request('DescribeCertificates', {
        SearchKey: cn.split('*.').join(''),
        Limit: 20,
      });
      if (!data.Certificates || data.Certificates.length === 0) return null;

      const matched: any[] = [];
      for (const cert of data.Certificates) {
        if (cert.Status !== 1) continue;
        if (cert.Domain !== cn && cert.Domain !== cn.split('*.').join('')) continue;
        matched.push(cert);
      }
      if (matched.length === 0) return null;

      matched.sort((a, b) => new Date(b.CertEndTime).getTime() - new Date(a.CertEndTime).getTime());

      return matched[0].CertificateId;
    } catch (e: any) {
      this.log('查询新证书ID失败：' + e.message);
      return null;
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}