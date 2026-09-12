import { TencentCDN } from './providers/TencentCDN.js';
import { TencentEdgeOne } from './providers/TencentEdgeOne.js';
import { AliyunCDN } from './providers/AliyunCDN.js';
import { AliyunESA } from './providers/AliyunESA.js';
import type { CdnProvider } from './types.js';

export interface CdnFieldConfig {
  name: string;
  type: 'input';
  placeholder?: string;
  required?: boolean;
}

export interface CdnProviderMeta {
  name: string;
  note?: string;
  config: Record<string, CdnFieldConfig>;
}

export const cdnConfig: Record<string, CdnProviderMeta> = {
  tencent_cdn: {
    name: '腾讯云 CDN',
    note: '加速域名接入腾讯云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
  tencent_edgeone: {
    name: '腾讯云 EdgeOne',
    note: '接入前请先在腾讯云 EdgeOne 控制台创建站点（Zone）',
    config: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
    },
  },
  aliyun_cdn: {
    name: '阿里云 CDN',
    note: '加速域名接入阿里云 CDN，拿到 CNAME 后可联动添加解析记录',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
    },
  },
  aliyun_esa: {
    name: '阿里云 ESA',
    note: '边缘安全加速，接入前请先在阿里云 ESA 控制台创建站点',
    config: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
    },
  },
};

const providerMap: Record<string, new (config: Record<string, any>) => CdnProvider> = {
  tencent_cdn: TencentCDN,
  tencent_edgeone: TencentEdgeOne,
  aliyun_cdn: AliyunCDN,
  aliyun_esa: AliyunESA,
};

export function getCdnProvider(type: string, config: Record<string, any>): CdnProvider | false {
  const Ctor = providerMap[type];
  if (!Ctor) return false;
  return new Ctor(config);
}

export function getCdnConfigList() {
  return cdnConfig;
}