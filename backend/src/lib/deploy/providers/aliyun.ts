import { X509Certificate } from 'node:crypto';
import { Aliyun } from '../../clients/Aliyun.js';
import { AliyunNew } from '../../clients/AliyunNew.js';
import { AliyunOSS } from '../../clients/AliyunOSS.js';
import type { DeployProvider } from '../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCertInfo(fullchain: string) {
  const x = new X509Certificate(fullchain);
  const extractCN = (s: string) => {
    const m = s.match(/CN=([^,\n]+)/);
    return m ? m[1].trim() : '';
  };
  return {
    subject: extractCN(x.subject),
    issuer: extractCN(x.issuer),
    validFrom: new Date(x.validFrom).getTime() / 1000,
    validTo: new Date(x.validTo).getTime() / 1000,
    serial: x.serialNumber.toLowerCase(),
  };
}

export class AliyunDeploy implements DeployProvider {
  private AccessKeyId: string;
  private AccessKeySecret: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKeyId = config.AccessKeyId || '';
    this.AccessKeySecret = config.AccessKeySecret || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private makeClient(endpoint: string, version: string): Aliyun {
    return new Aliyun(this.AccessKeyId, this.AccessKeySecret, endpoint, version);
  }

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.AccessKeySecret) throw new Error('必填参数不能为空');
    const client = this.makeClient('cas.aliyuncs.com', '2020-04-07');
    await client.request({ Action: 'ListUserCertificateOrder' });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void> {
    if (config.product === 'api') return await this.deployApi(fullchain, privatekey, config);
    if (config.product === 'vod') return await this.deployVod(fullchain, privatekey, config);
    if (config.product === 'fc') return await this.deployFc(fullchain, privatekey, config, '2023-03-30');
    if (config.product === 'fc2') return await this.deployFc(fullchain, privatekey, config, '2021-04-06');

    const [certId, certName] = await this.getCertId(fullchain, privatekey, config);
    if (!certId) throw new Error('证书ID获取失败');

    const p = config.product;
    if (p === 'cdn') await this.deployCdn(certId, certName, config);
    else if (p === 'dcdn') await this.deployDcdn(certId, certName, config);
    else if (p === 'esa') await this.deployEsa(certId, certName, config);
    else if (p === 'oss') await this.deployOss(certId, config);
    else if (p === 'waf') await this.deployWaf(certId, config);
    else if (p === 'wafres') await this.deployWafRes(certId, config);
    else if (p === 'waf2') await this.deployWaf2(certId, config);
    else if (p === 'ddoscoo') await this.deployDdoscoo(certId, config);
    else if (p === 'live') await this.deployLive(certId, certName, config);
    else if (p === 'clb') await this.deployClb(certId, certName, config);
    else if (p === 'alb') await this.deployAlb(certId, config);
    else if (p === 'nlb') await this.deployNlb(certId, config);
    else if (p === 'esa_saas') await this.deployEsaSaas(certId, config);
    else if (p === 'ga') await this.deployGa(certId, config);
    else if (p === 'upload') {
      // no-op
    } else {
      throw new Error('未知的产品类型');
    }
    info.cert_id = certId;
    info.cert_name = certName;
  }

  private async getCertId(fullchain: string, privatekey: string, config: Record<string, any>): Promise<[string, string]> {
    const certInfo = parseCertInfo(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    let certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);
    const serialNo = certInfo.serial;

    const endpoint = config.region === 'ap-southeast-1' ? 'cas.ap-southeast-1.aliyuncs.com' : 'cas.aliyuncs.com';
    const client = this.makeClient(endpoint, '2020-04-07');

    let data: any;
    try {
      data = await client.request({
        Action: 'ListUserCertificateOrder',
        Keyword: certInfo.subject,
        OrderType: 'CERT',
      });
    } catch (e: any) {
      throw new Error('查询证书列表失败：' + e.message);
    }
    let certId: string | null = null;
    if (data.TotalCount > 0 && data.CertificateOrderList && data.CertificateOrderList.length > 0) {
      for (const cert of data.CertificateOrderList) {
        if (String(cert.SerialNo).toLowerCase() === serialNo || String(cert.SerialNo).toLowerCase().includes(serialNo)) {
          certId = cert.CertificateId;
          certName = cert.Name;
          break;
        }
      }
    }
    if (certId) {
      this.log('找到已上传的证书 CertId=' + certId);
      return [certId, certName];
    }

    try {
      data = await client.request({
        Action: 'UploadUserCertificate',
        Name: certName,
        Cert: fullchain,
        Key: privatekey,
      });
    } catch (e: any) {
      throw new Error('上传证书失败：' + e.message);
    }
    this.log('证书上传成功！CertId=' + data.CertId);
    await sleep(500);
    return [data.CertId, certName];
  }

  private async deployCdn(certId: string, certName: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('CDN绑定域名不能为空');
    const client = this.makeClient('cdn.aliyuncs.com', '2018-05-10');
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.request({
        Action: 'SetCdnDomainSSLCertificate',
        DomainName: domain,
        CertName: certName,
        CertType: 'cas',
        SSLProtocol: 'on',
        CertId: certId,
      });
      this.log('CDN域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployDcdn(certId: string, certName: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('DCDN绑定域名不能为空');
    const client = this.makeClient('dcdn.aliyuncs.com', '2018-01-15');
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.request({
        Action: 'SetDcdnDomainSSLCertificate',
        DomainName: domain,
        CertName: certName,
        CertType: 'cas',
        SSLProtocol: 'on',
        CertId: certId,
      });
      this.log('DCDN域名 ' + domain + ' 部署证书成功！');
    }
  }

  private esaEndpoint(config: Record<string, any>): string {
    return config.region === 'ap-southeast-1' ? 'esa.ap-southeast-1.aliyuncs.com' : 'esa.cn-hangzhou.aliyuncs.com';
  }

  private async deployEsaSaas(casId: string, config: Record<string, any>): Promise<void> {
    const sitename = config.esa_sitename;
    const saasSitename = config.esa_saas_sitename;
    if (!sitename) throw new Error('ESA站点名称不能为空');
    if (!saasSitename) throw new Error('ESA SAAS域名不能为空');

    const client = this.makeClient(this.esaEndpoint(config), '2024-09-10');

    let data: any;
    try {
      data = await client.request({ Action: 'ListSites', SiteName: sitename, SiteSearchType: 'exact' }, 'GET');
    } catch (e: any) {
      throw new Error('查询ESA站点列表失败：' + e.message);
    }
    if (data.TotalCount === 0) throw new Error('ESA站点 ' + sitename + ' 不存在');
    this.log('成功查询到' + data.TotalCount + '个ESA站点');
    const siteId = data.Sites[0].SiteId;

    let saasData: any;
    try {
      saasData = await client.request({ Action: 'ListCustomHostnames', SiteName: saasSitename, SiteId: siteId, SiteSearchType: 'exact' }, 'GET');
    } catch (e: any) {
      throw new Error('查询ESA saas域名失败：' + e.message);
    }
    if (saasData.TotalCount === 0) throw new Error('ESA saas站点 ' + saasSitename + ' 不存在');
    const saasHostnameId = saasData.Hostnames[0].HostnameId;

    const param = {
      Action: 'UpdateCustomHostname',
      HostnameId: saasHostnameId,
      SslFlag: 'on',
      CertType: 'cas',
      CasId: casId,
      CasRegion: config.region,
    };
    this.log('ESA SAAS站点部署参数 ' + JSON.stringify(param));
    try {
      const result = await client.request(param);
      this.log('ESA SAAS站点部署结果 ' + JSON.stringify(result));
    } catch (e: any) {
      throw new Error('部署失败：' + e.message);
    }
    this.log('ESA SAAS站点 ' + saasSitename + ' 证书添加成功！');
  }

  private async deployEsa(casId: string, certName: string, config: Record<string, any>): Promise<void> {
    const sitename = config.esa_sitename;
    if (!sitename) throw new Error('ESA站点名称不能为空');

    const client = this.makeClient(this.esaEndpoint(config), '2024-09-10');

    let data: any;
    try {
      data = await client.request({ Action: 'ListSites', SiteName: sitename, SiteSearchType: 'exact' }, 'GET');
    } catch (e: any) {
      throw new Error('查询ESA站点列表失败：' + e.message);
    }
    if (data.TotalCount === 0) throw new Error('ESA站点 ' + sitename + ' 不存在');
    this.log('成功查询到' + data.TotalCount + '个ESA站点');
    const siteId = data.Sites[0].SiteId;

    try {
      data = await client.request({ Action: 'ListCertificates', SiteId: siteId }, 'GET');
    } catch (e: any) {
      throw new Error('查询ESA站点' + sitename + '证书列表失败：' + e.message);
    }
    this.log('ESA站点 ' + sitename + ' 查询到' + data.TotalCount + '个SSL证书');

    let existCert: any = null;
    let oldestCert: any = null;
    if (data.TotalCount > 0) {
      for (const cert of data.Result || []) {
        if (cert.Type === 'free') continue;
        const doms = String(cert.SAN || '').split(',');
        let flag = true;
        for (const domain of doms) {
          if (!(config.domainList || []).includes(domain)) {
            flag = false;
            break;
          }
        }
        if (flag) {
          existCert = cert;
          break;
        }
        if (!oldestCert) {
          oldestCert = cert;
        } else if (new Date(cert.CreateTime).getTime() < new Date(oldestCert.CreateTime).getTime()) {
          oldestCert = cert;
        }
      }
    }

    if (!existCert) {
      try {
        data = await client.request({ Action: 'ListInstanceQuotasWithUsage', SiteId: siteId, QuotaNames: 'customHttpCert' }, 'GET');
      } catch (e: any) {
        throw new Error('查询ESA站点证书配额失败：' + e.message);
      }
      if (data.Quotas && data.Quotas.length > 0 && parseInt(data.Quotas[0].Usage) >= parseInt(data.Quotas[0].QuotaValue) && oldestCert) {
        try {
          await client.request({ Action: 'DeleteCertificate', SiteId: siteId, Id: oldestCert.Id }, 'GET');
          this.log('ESA站点 ' + sitename + ' 删除证书 ' + oldestCert.Name + ' 成功');
        } catch (e: any) {
          throw new Error('ESA站点 ' + sitename + ' 删除证书' + oldestCert.Name + '失败：' + e.message);
        }
      }
    }

    const param: Record<string, any> = {
      Action: 'SetCertificate',
      SiteId: siteId,
      Type: 'cas',
      CasId: casId,
      Name: certName,
      Region: config.region,
    };

    if (existCert) {
      param.Id = existCert.Id;
      if (existCert.CasId === casId) {
        this.log('ESA站点 ' + sitename + ' 证书已配置，无需重复操作');
        return;
      }
    }

    await client.request(param);

    if (existCert) {
      this.log('ESA站点 ' + sitename + ' 证书 ' + existCert.Name + ' 更新成功');
    } else {
      this.log('ESA站点 ' + sitename + ' 证书添加成功！');
    }
  }

  private async deployOss(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('OSS绑定域名不能为空');
    if (!config.oss_endpoint) throw new Error('OSS Endpoint不能为空');
    if (!config.oss_bucket) throw new Error('OSS Bucket不能为空');
    const client = new AliyunOSS(this.AccessKeyId, this.AccessKeySecret, config.oss_endpoint);
    for (const domain of String(config.domain).split(',')) {
      if (!domain) continue;
      await client.addBucketCnameCert(config.oss_bucket, domain, certId + '-cn-hangzhou');
      this.log('OSS域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployWaf(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('WAF绑定域名不能为空');

    let fullCertId = certId;
    if (config.region === 'ap-southeast-1') {
      fullCertId += '-ap-southeast-1';
    } else {
      fullCertId += '-cn-hangzhou';
    }

    const endpoint = 'wafopenapi.' + config.region + '.aliyuncs.com';
    const client = this.makeClient(endpoint, '2021-10-01');

    let data: any;
    try {
      data = await client.request({ Action: 'DescribeInstance', RegionId: config.region }, 'GET');
    } catch (e: any) {
      throw new Error('获取WAF实例详情失败：' + e.message);
    }
    if (!data.InstanceId) throw new Error('当前账号未找到WAF实例');
    const instanceId = data.InstanceId;
    this.log('获取WAF实例ID成功 InstanceId=' + instanceId);

    for (const domain of String(config.domain).split(',')) {
      try {
        data = await client.request({ Action: 'DescribeDomainDetail', InstanceId: instanceId, Domain: domain, RegionId: config.region }, 'GET');
      } catch (e: any) {
        throw new Error('查询CNAME接入详情失败：' + e.message);
      }
      if (!data.Listen) {
        throw new Error('没有找到' + domain + '监听器');
      }

      const listen = data.Listen;
      if (listen.CertId !== undefined) {
        const oldCertId = listen.CertId;
        if (oldCertId && oldCertId === fullCertId) {
          this.log('WAF域名 ' + domain + ' 证书已配置，无需重复操作');
          return;
        }
      }

      listen.CertId = fullCertId;
      if (!listen.HttpsPorts) {
        listen.HttpsPorts = [443];
        listen.TLSVersion = 'tlsv1.1';
        listen.EnableTLSv3 = true;
        listen.CipherSuite = 1;
      }
      const redirect = data.Redirect || {};
      if (redirect.BackendPorts && redirect.BackendPorts.length === 1 && redirect.BackendPorts[0].Protocol === 'http') {
        redirect.BackendPorts.push({
          ListenPort: 443,
          Protocol: 'https',
          BackendPort: redirect.BackendPorts[0].BackendPort,
        });
        redirect.FocusHttpBackend = true;
      }
      redirect.Backends = redirect.AllBackends;

      await client.request({
        Action: 'ModifyDomain',
        InstanceId: instanceId,
        Domain: domain,
        Listen: JSON.stringify(listen),
        Redirect: JSON.stringify(redirect),
        RegionId: config.region,
      });

      this.log('WAF域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployWafRes(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.waf_resource_id) throw new Error('云产品防护对象ID不能为空');
    const deployType = config.deploy_type ? parseInt(config.deploy_type) : 0;

    let fullCertId = certId;
    if (config.region === 'ap-southeast-1') {
      fullCertId += '-ap-southeast-1';
    } else {
      fullCertId += '-cn-hangzhou';
    }

    const endpoint = 'wafopenapi.' + config.region + '.aliyuncs.com';
    const client = this.makeClient(endpoint, '2021-10-01');

    let data: any;
    try {
      data = await client.request({ Action: 'DescribeInstance', RegionId: config.region }, 'GET');
    } catch (e: any) {
      throw new Error('获取WAF实例详情失败：' + e.message);
    }
    if (!data.InstanceId) throw new Error('当前账号未找到WAF实例');
    const instanceId = data.InstanceId;
    this.log('获取WAF实例ID成功 InstanceId=' + instanceId);

    for (const wafResourceId of String(config.waf_resource_id).split(',')) {
      const parts = wafResourceId.split('-');
      const resourceInstanceId = parts[parts.length - 3] || '';
      if (!resourceInstanceId) {
        throw new Error('ResourceInstanceId解析失败：' + wafResourceId);
      }
      try {
        data = await client.request({ Action: 'DescribeCloudResourceList', InstanceId: instanceId, CloudResourceId: wafResourceId, RegionId: config.region }, 'GET');
      } catch (e: any) {
        throw new Error('查询云产品接入WAF配置失败：' + e.message);
      }
      if (!data.CloudResourceList || data.CloudResourceList.length === 0) {
        throw new Error('WAF云产品接入实例不存在：' + wafResourceId);
      }

      if (deployType === 0) {
        await client.request({
          Action: 'ModifyCloudResourceDefaultCert',
          InstanceId: instanceId,
          CloudResourceId: wafResourceId,
          CertId: fullCertId,
          RegionId: config.region,
        });
        this.log('WAF云产品防护对象 ' + wafResourceId + ' 部署默认证书成功！');
      } else {
        await client.request({
          Action: 'CreateCloudResourceExtensionCert',
          InstanceId: instanceId,
          CloudResourceId: wafResourceId,
          CertId: fullCertId,
          RegionId: config.region,
        });
        this.log('WAF云产品防护对象 ' + wafResourceId + ' 部署扩展证书成功！');
        await this.cleanWafResExpiredCerts(client, instanceId, resourceInstanceId, wafResourceId, config.region);
      }
    }
  }

  private async cleanWafResExpiredCerts(client: Aliyun, instanceId: string, resourceInstanceId: string, wafResourceId: string, region: string): Promise<void> {
    let data: any;
    try {
      data = await client.request({ Action: 'DescribeResourceInstanceCerts', InstanceId: instanceId, ResourceInstanceId: resourceInstanceId, RegionId: region }, 'GET');
    } catch (e: any) {
      this.log('查询扩展证书列表失败：' + e.message);
      return;
    }
    if (!data.Certs || data.Certs.length === 0) return;

    const now = Math.floor(Date.now() / 1000);
    for (const cert of data.Certs) {
      if (!cert.CertIdentifier || !cert.AfterDate) continue;
      const expireTime = Math.floor(new Date(cert.AfterDate).getTime() / 1000);
      if (!isNaN(expireTime) && expireTime < now) {
        try {
          await client.request({
            Action: 'DeleteCloudResourceExtensionCert',
            InstanceId: instanceId,
            CloudResourceId: wafResourceId,
            CertId: cert.CertIdentifier,
            RegionId: region,
          });
          this.log('已删除过期扩展证书：' + cert.CertIdentifier);
        } catch (e: any) {
          this.log('删除过期扩展证书失败：' + cert.CertIdentifier + ' ' + e.message);
        }
      }
    }
  }

  private async deployWaf2(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('WAF绑定域名不能为空');
    const endpoint = 'wafopenapi.' + config.region + '.aliyuncs.com';
    const client = this.makeClient(endpoint, '2019-09-10');

    let data: any;
    try {
      data = await client.request({ Action: 'DescribeInstanceInfo', RegionId: config.region }, 'GET');
    } catch (e: any) {
      throw new Error('获取WAF实例详情失败：' + e.message);
    }
    if (!data.InstanceInfo || !data.InstanceInfo.InstanceId) throw new Error('当前账号未找到WAF实例');
    const instanceId = data.InstanceInfo.InstanceId;
    this.log('获取WAF实例ID成功 InstanceId=' + instanceId);

    for (const domain of String(config.domain).split(',')) {
      await client.request({
        Action: 'CreateCertificateByCertificateId',
        InstanceId: instanceId,
        Domain: domain,
        CertificateId: certId,
      });
      this.log('WAF域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployApi(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    const groupid = config.api_groupid;
    if (!groupid) throw new Error('API分组ID不能为空');
    if (!config.domain) throw new Error('API分组绑定域名不能为空');

    const certInfo = parseCertInfo(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const client = this.makeClient('apigateway.' + config.regionid + '.aliyuncs.com', '2016-07-14');

    for (const domain of String(config.domain).split(',')) {
      await client.request({
        Action: 'SetDomainCertificate',
        GroupId: groupid,
        DomainName: domain,
        CertificateName: certName,
        CertificateBody: fullchain,
        CertificatePrivateKey: privatekey,
      });
      this.log('API网关域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployDdoscoo(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('绑定域名不能为空');
    const client = this.makeClient('ddoscoo.' + config.region + '.aliyuncs.com', '2020-01-01');
    for (const domain of String(config.domain).split(',')) {
      await client.request({ Action: 'AssociateWebCert', Domain: domain, CertId: certId });
      this.log('DDoS高防域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployLive(certId: string, certName: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('视频直播绑定域名不能为空');
    const client = this.makeClient('live.aliyuncs.com', '2016-11-01');
    for (const domain of String(config.domain).split(',')) {
      await client.request({
        Action: 'SetLiveDomainCertificate',
        DomainName: domain,
        CertName: certName,
        CertType: 'cas',
        SSLProtocol: 'on',
        CertId: certId,
      });
      this.log('设置视频直播域名 ' + domain + ' 证书成功！');
    }
  }

  private async deployVod(fullchain: string, privatekey: string, config: Record<string, any>): Promise<void> {
    if (!config.domain) throw new Error('视频点播绑定域名不能为空');
    const client = this.makeClient('vod.cn-shanghai.aliyuncs.com', '2017-03-21');
    for (const domain of String(config.domain).split(',')) {
      await client.request({
        Action: 'SetVodDomainCertificate',
        DomainName: domain,
        SSLProtocol: 'on',
        SSLPub: fullchain,
        SSLPri: privatekey,
      });
      this.log('视频点播域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployFc(fullchain: string, privatekey: string, config: Record<string, any>, version: string): Promise<void> {
    const fcCname = config.fc_cname;
    if (!config.domain) throw new Error('函数计算域名不能为空');
    if (!fcCname) throw new Error('域名CNAME地址不能为空');

    const certInfo = parseCertInfo(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    const client = new AliyunNew(this.AccessKeyId, this.AccessKeySecret, fcCname, version);

    for (const domain of String(config.domain).split(',')) {
      let data: any;
      try {
        data = await client.request('GET', 'GetCustomDomain', '/' + version + '/custom-domains/' + domain);
      } catch (e: any) {
        throw new Error('获取绑定域名信息失败：' + e.message);
      }
      this.log('获取函数计算绑定域名信息成功');

      if (data.certConfig && data.certConfig.certificate === fullchain) {
        this.log('函数计算域名 ' + domain + ' 证书已配置，无需重复操作');
        return;
      }

      if (data.protocol === 'HTTP') data.protocol = 'HTTP,HTTPS';
      data.certConfig.certName = certName;
      data.certConfig.certificate = fullchain;
      data.certConfig.privateKey = privatekey;

      const param: Record<string, any> = {
        authConfig: data.authConfig,
        certConfig: data.certConfig,
        protocol: data.protocol,
        routeConfig: data.routeConfig,
        tlsConfig: data.tlsConfig,
        wafConfig: data.wafConfig,
      };
      await client.request('PUT', 'UpdateCustomDomain', '/' + version + '/custom-domains/' + domain, param);

      this.log('函数计算域名 ' + domain + ' 部署证书成功！');
    }
  }

  private async deployClb(certId: string, certName: string, config: Record<string, any>): Promise<void> {
    if (!config.clb_id) throw new Error('负载均衡实例ID不能为空');
    if (!config.clb_port) throw new Error('HTTPS监听端口不能为空');

    const endpoint = 'slb.' + config.regionid + '.aliyuncs.com';
    const client = this.makeClient(endpoint, '2014-05-15');

    let data: any;
    try {
      data = await client.request({ Action: 'DescribeServerCertificates', RegionId: config.regionid });
    } catch (e: any) {
      throw new Error('获取服务器证书列表失败：' + e.message);
    }

    let serverCertificateId: string | null = null;
    const certs = data.ServerCertificates && data.ServerCertificates.ServerCertificate ? data.ServerCertificates.ServerCertificate : [];
    const certArr = Array.isArray(certs) ? certs : [certs];
    for (const cert of certArr) {
      if (cert.IsAliCloudCertificate === 1 && cert.AliCloudCertificateId === certId) {
        serverCertificateId = cert.ServerCertificateId;
        break;
      }
    }
    if (!serverCertificateId) {
      try {
        data = await client.request({
          Action: 'UploadServerCertificate',
          RegionId: config.regionid,
          AliCloudCertificateId: certId,
          AliCloudCertificateName: certName,
          AliCloudCertificateRegionId: 'cn-hangzhou',
        });
      } catch (e: any) {
        throw new Error('服务器证书添加失败：' + e.message);
      }
      serverCertificateId = data.ServerCertificateId;
      this.log('服务器证书添加成功 ServerCertificateId=' + serverCertificateId);
    } else {
      this.log('找到已添加的服务器证书 ServerCertificateId=' + serverCertificateId);
    }

    const deployType = config.deploy_type ? parseInt(config.deploy_type) : 0;
    if (deployType === 1) {
      if (!config.clb_domain) throw new Error('扩展域名不能为空');
      const domains = String(config.clb_domain).split(',');
      try {
        data = await client.request({ Action: 'DescribeDomainExtensions', RegionId: config.regionid, LoadBalancerId: config.clb_id, ListenerPort: config.clb_port });
      } catch (e: any) {
        throw new Error('扩展域名列表查询失败：' + e.message);
      }
      const exts = data.DomainExtensions && data.DomainExtensions.DomainExtension ? data.DomainExtensions.DomainExtension : [];
      const extArr = Array.isArray(exts) ? exts : [exts];
      for (const item of extArr) {
        if (domains.includes(item.Domain)) {
          if (serverCertificateId === item.ServerCertificateId) {
            this.log('负载均衡HTTPS扩展域名 ' + item.Domain + ' 证书已配置');
          } else {
            await client.request({
              Action: 'SetDomainExtensionAttribute',
              RegionId: config.regionid,
              DomainExtensionId: item.DomainExtensionId,
              ServerCertificateId: serverCertificateId,
            });
            this.log('负载均衡HTTPS扩展域名 ' + item.Domain + ' 证书更新成功');
          }
        }
      }
    } else {
      try {
        data = await client.request({ Action: 'DescribeLoadBalancerHTTPSListenerAttribute', RegionId: config.regionid, LoadBalancerId: config.clb_id, ListenerPort: config.clb_port });
      } catch (e: any) {
        throw new Error('HTTPS监听配置查询失败：' + e.message);
      }

      if (data.ServerCertificateId === serverCertificateId) {
        this.log('负载均衡HTTPS监听已配置该证书，无需重复操作');
        return;
      }

      await client.request({
        Action: 'SetLoadBalancerHTTPSListenerAttribute',
        RegionId: config.regionid,
        LoadBalancerId: config.clb_id,
        ListenerPort: config.clb_port,
        ServerCertificateId: serverCertificateId,
      });
      this.log('负载均衡HTTPS监听证书配置成功！');
    }
  }

  private async deployAlb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.alb_listener_id) throw new Error('负载均衡监听ID不能为空');
    const client = this.makeClient('alb.' + config.regionid + '.aliyuncs.com', '2020-06-16');
    const fullCertId = certId + '-cn-hangzhou';
    const deployType = config.deploy_type ? parseInt(config.deploy_type) : 0;

    if (deployType === 1) {
      let data: any;
      try {
        data = await client.request({ Action: 'ListListenerCertificates', MaxResults: 100, ListenerId: config.alb_listener_id, CertificateType: 'Server' });
      } catch (e: any) {
        throw new Error('获取监听证书列表失败：' + e.message);
      }
      for (const cert of data.Certificates || []) {
        if (cert.CertificateId === fullCertId) {
          this.log('负载均衡监听扩展证书已添加，无需重复操作');
          return;
        }
      }
      await client.request({
        Action: 'AssociateAdditionalCertificatesWithListener',
        ListenerId: config.alb_listener_id,
        'Certificates.1.CertificateId': fullCertId,
      });
      this.log('应用型负载均衡监听扩展证书添加成功！');
    } else {
      await client.request({
        Action: 'UpdateListenerAttribute',
        ListenerId: config.alb_listener_id,
        'Certificates.1.CertificateId': fullCertId,
      });
      this.log('应用型负载均衡监听默认证书更新成功！');
    }
  }

  private async deployNlb(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.nlb_listener_id) throw new Error('负载均衡监听ID不能为空');
    const client = this.makeClient('nlb.' + config.regionid + '.aliyuncs.com', '2022-04-30');
    const fullCertId = certId + '-cn-hangzhou';
    const deployType = config.deploy_type ? parseInt(config.deploy_type) : 0;

    if (deployType === 1) {
      let data: any;
      try {
        data = await client.request({ Action: 'ListListenerCertificates', MaxResults: 50, ListenerId: config.nlb_listener_id, CertificateType: 'Server' });
      } catch (e: any) {
        throw new Error('获取监听证书列表失败：' + e.message);
      }
      for (const cert of data.Certificates || []) {
        if (cert.CertificateId === fullCertId) {
          this.log('负载均衡监听扩展证书已添加，无需重复操作');
          return;
        }
      }
      await client.request({
        Action: 'AssociateAdditionalCertificatesWithListener',
        ListenerId: config.nlb_listener_id,
        'AdditionalCertificateIds.1': fullCertId,
      });
      this.log('网络型负载均衡监听扩展证书添加成功！');
    } else {
      await client.request({
        Action: 'UpdateListenerAttribute',
        ListenerId: config.nlb_listener_id,
        'CertificateIds.1': fullCertId,
      });
      this.log('网络型负载均衡监听默认证书更新成功！');
    }
  }

  private async deployGa(certId: string, config: Record<string, any>): Promise<void> {
    if (!config.ga_id) throw new Error('全球加速实例ID不能为空');
    if (!config.ga_listener_id) throw new Error('全球加速监听ID不能为空');

    const client = this.makeClient('ga.cn-hangzhou.aliyuncs.com', '2019-11-20');
    const fullCertId = certId + '-cn-hangzhou';
    const deployType = config.deploy_type ? parseInt(config.deploy_type) : 0;

    if (deployType === 1) {
      if (!config.clb_domain) throw new Error('扩展域名不能为空');
      let data: any;
      try {
        data = await client.request({ Action: 'ListListenerCertificates', RegionId: 'cn-hangzhou', AcceleratorId: config.ga_id, ListenerId: config.ga_listener_id });
      } catch (e: any) {
        throw new Error('扩展域名列表查询失败：' + e.message);
      }
      const needAdd: string[] = [];
      for (const domain of String(config.clb_domain).split(',')) {
        let domainExists = false;
        let existCertId: string | null = null;
        for (const cert of data.Certificates || []) {
          if (cert.Domain && domain === cert.Domain) {
            domainExists = true;
            existCertId = cert.CertificateId;
          }
        }
        if (domainExists) {
          if (existCertId === fullCertId) {
            this.log('全球加速实例监听扩展域名 ' + domain + ' 证书已配置');
            continue;
          }
          await client.request({
            Action: 'UpdateAdditionalCertificateWithListener',
            RegionId: 'cn-hangzhou',
            AcceleratorId: config.ga_id,
            ListenerId: config.ga_listener_id,
            Domain: domain,
            CertificateId: fullCertId,
          });
          this.log('全球加速实例监听扩展域名 ' + domain + ' 替换证书成功！');
        } else {
          needAdd.push(domain);
        }
      }
      if (needAdd.length > 0) {
        const param: Record<string, any> = {
          Action: 'AssociateAdditionalCertificatesWithListener',
          RegionId: 'cn-hangzhou',
          AcceleratorId: config.ga_id,
          ListenerId: config.ga_listener_id,
        };
        needAdd.forEach((domain, index) => {
          param['Certificates.' + (index + 1) + '.Id'] = fullCertId;
          param['Certificates.' + (index + 1) + '.Domain'] = domain;
        });
        await client.request(param);
        this.log('全球加速实例监听扩展域名 ' + needAdd.join(',') + ' 绑定证书成功！');
      }
    } else {
      await client.request({
        Action: 'UpdateListener',
        RegionId: 'cn-hangzhou',
        AcceleratorId: config.ga_id,
        ListenerId: config.ga_listener_id,
        'Certificates.1.Id': fullCertId,
      });
      this.log('全球加速实例监听默认证书更新成功！');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}