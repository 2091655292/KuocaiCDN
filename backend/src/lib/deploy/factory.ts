import { deployConfig, deployClassConfig } from './meta.js';
import { LocalDeploy } from './providers/local.js';
import { FtpDeploy } from './providers/ftp.js';
import { SshDeploy } from './providers/ssh.js';
import { BtpanelDeploy } from './providers/btpanel.js';
import { NginxProxyManagerDeploy } from './providers/nginxproxymanager.js';
import { LuckyDeploy } from './providers/lucky.js';
import { SafelineDeploy } from './providers/safeline.js';
import { KsyunDeploy } from './providers/ksyun.js';
import { BaishanDeploy } from './providers/baishan.js';
import { GoedgeDeploy } from './providers/goedge.js';
import { LecdnDeploy } from './providers/lecdn.js';
import { UusecDeploy } from './providers/uusec.js';
import { CacheflyDeploy } from './providers/cachefly.js';
import { GcoreDeploy } from './providers/gcore.js';
import { KuocaiDeploy } from './providers/kuocai.js';
import { RainyunDeploy } from './providers/rainyun.js';
import { UcloudDeploy } from './providers/ucloud.js';
import { MwpanelDeploy } from './providers/mwpanel.js';
import { AcepanelDeploy } from './providers/acepanel.js';
import { RatpanelDeploy } from './providers/ratpanel.js';
import { ProxmoxDeploy } from './providers/proxmox.js';
import { XpDeploy } from './providers/xp.js';
import { AxisnowDeploy } from './providers/axisnow.js';
import { BtwafDeploy } from './providers/btwaf.js';
import { CdnflyDeploy } from './providers/cdnfly.js';
import { SynologyDeploy } from './providers/synology.js';
import { BtwinDeploy } from './providers/btwin.js';
import { FnosDeploy } from './providers/fnos.js';
import { OpanelDeploy } from './providers/opanel.js';
import { K8sDeploy } from './providers/k8s.js';
import { AwsDeploy } from './providers/aws.js';
import { TencentDeploy } from './providers/tencent.js';
import { WangsuDeploy } from './providers/wangsu.js';
import { AliyunDeploy } from './providers/aliyun.js';
import { UnicloudDeploy } from './providers/unicloud.js';
import { AmhDeploy } from './providers/amh.js';
import { BaiduDeploy } from './providers/baidu.js';
import { CtyunDeploy } from './providers/ctyun.js';
import { DirectadminDeploy } from './providers/directadmin.js';
import { DogeDeploy } from './providers/doge.js';
import { HuaweiDeploy } from './providers/huawei.js';
import { HuoshanDeploy } from './providers/huoshan.js';
import { KangleDeploy } from './providers/kangle.js';
import { KangleadminDeploy } from './providers/kangleadmin.js';
import { QiniuDeploy } from './providers/qiniu.js';
import { S3storageDeploy } from './providers/s3storage.js';
import { UpyunDeploy } from './providers/upyun.js';
import { WestDeploy } from './providers/west.js';
import type { DeployProvider } from './types.js';

export { deployConfig, deployClassConfig };

const providerMap: Record<string, new (config: Record<string, any>) => DeployProvider> = {
  local: LocalDeploy,
  ftp: FtpDeploy,
  ssh: SshDeploy,
  btpanel: BtpanelDeploy,
  nginxproxymanager: NginxProxyManagerDeploy,
  lucky: LuckyDeploy,
  safeline: SafelineDeploy,
  ksyun: KsyunDeploy,
  baishan: BaishanDeploy,
  goedge: GoedgeDeploy,
  lecdn: LecdnDeploy,
  uusec: UusecDeploy,
  cachefly: CacheflyDeploy,
  gcore: GcoreDeploy,
  kuocai: KuocaiDeploy,
  rainyun: RainyunDeploy,
  ucloud: UcloudDeploy,
  mwpanel: MwpanelDeploy,
  acepanel: AcepanelDeploy,
  ratpanel: RatpanelDeploy,
  proxmox: ProxmoxDeploy,
  xp: XpDeploy,
  axisnow: AxisnowDeploy,
  btwaf: BtwafDeploy,
  cdnfly: CdnflyDeploy,
  synology: SynologyDeploy,
  btwin: BtwinDeploy,
  fnos: FnosDeploy,
  opanel: OpanelDeploy,
  k8s: K8sDeploy,
  aws: AwsDeploy,
  tencent: TencentDeploy,
  wangsu: WangsuDeploy,
  aliyun: AliyunDeploy,
  unicloud: UnicloudDeploy,
  amh: AmhDeploy,
  baidu: BaiduDeploy,
  ctyun: CtyunDeploy,
  directadmin: DirectadminDeploy,
  doge: DogeDeploy,
  huawei: HuaweiDeploy,
  huoshan: HuoshanDeploy,
  kangle: KangleDeploy,
  kangleadmin: KangleadminDeploy,
  qiniu: QiniuDeploy,
  s3storage: S3storageDeploy,
  upyun: UpyunDeploy,
  west: WestDeploy,
};

export function isDeployImplemented(type: string): boolean {
  return type in providerMap;
}

export function getDeployProvider(type: string, config: Record<string, any>): DeployProvider | null {
  const C = providerMap[type];
  if (!C) return null;
  return new C(config);
}