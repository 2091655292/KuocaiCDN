import { LetsencryptCert } from './providers/letsencrypt.js';
import { ZerosslCert } from './providers/zerossl.js';
import { GoogleCert } from './providers/google.js';
import { LitesslCert } from './providers/litessl.js';
import { CustomacmeCert } from './providers/customacme.js';
import { TencentCert } from './providers/tencent.js';
import { AliyunCert } from './providers/aliyun.js';
import { UcloudCert } from './providers/ucloud.js';
import type { CertProvider } from './types.js';

export interface CertFieldConfig {
  name: string;
  type: 'input' | 'radio' | 'select';
  placeholder?: string;
  options?: Record<string, string>;
  value?: string;
  required?: boolean;
  show?: string;
}

const proxyField: CertFieldConfig = {
  name: '使用代理服务器',
  type: 'radio',
  options: { '0': '否', '1': '是' },
  value: '0',
};

export const certConfig: Record<string, any> = {
  letsencrypt: {
    name: "Let's Encrypt",
    class: 1,
    icon: 'letsencrypt.ico',
    wildcard: true,
    max_domains: 100,
    cname: true,
    inputs: {
      email: { name: '邮箱地址', type: 'input', placeholder: '用于注册Let\'s Encrypt账号', required: true },
      mode: { name: '环境选择', type: 'radio', options: { live: '正式环境', staging: '测试环境' }, value: 'live' },
      proxy: proxyField,
    },
  },
  zerossl: {
    name: 'ZeroSSL',
    class: 1,
    icon: 'zerossl.ico',
    wildcard: true,
    max_domains: 100,
    cname: true,
    note: '<a href="https://app.zerossl.com/developer" target="_blank" rel="noreferrer">ZeroSSL密钥手动获取</a>',
    inputs: {
      email: { name: '邮箱地址', type: 'input', placeholder: 'EAB申请邮箱', required: true },
      eabMode: { name: 'EAB获取方式', type: 'radio', options: { auto: '自动获取', manual: '手动输入' }, value: 'manual' },
      kid: { name: 'EAB KID', type: 'input', required: true, show: "eabMode=='manual'" },
      key: { name: 'EAB HMAC Key', type: 'input', required: true, show: "eabMode=='manual'" },
      proxy: proxyField,
    },
  },
  google: {
    name: 'Google SSL',
    class: 1,
    icon: 'google.ico',
    wildcard: true,
    max_domains: 100,
    cname: true,
    note: '<a href="https://cloud.google.com/certificate-manager/docs/public-ca-tutorial" target="_blank" rel="noreferrer">查看Google SSL账户手动配置说明</a>',
    inputs: {
      email: { name: '邮箱地址', type: 'input', placeholder: 'EAB申请邮箱', required: true },
      eabMode: { name: 'EAB获取方式', type: 'radio', options: { auto: '自动获取', manual: '手动输入' }, value: 'manual' },
      kid: { name: 'keyId', type: 'input', required: true, show: "eabMode=='manual'" },
      key: { name: 'b64MacKey', type: 'input', required: true, show: "eabMode=='manual'" },
      mode: { name: '环境选择', type: 'radio', options: { live: '正式环境', staging: '测试环境' }, value: 'live' },
      proxy: { name: '使用代理服务器', type: 'radio', options: { '0': '否', '1': '是', '2': '是（反向代理）' }, value: '0' },
      proxy_url: { name: '反向代理地址', type: 'input', placeholder: 'https://gts.rat.dev', required: true, show: 'proxy==2' },
    },
  },
  litessl: {
    name: 'LiteSSL',
    class: 1,
    icon: 'litessl.ico',
    wildcard: true,
    max_domains: 100,
    cname: true,
    note: '<a href="https://freessl.cn/automation/eab-manager" target="_blank" rel="noreferrer">LiteSSL密钥获取</a>',
    inputs: {
      email: { name: '邮箱地址', type: 'input', placeholder: 'EAB申请邮箱', required: true },
      kid: { name: 'EAB KID', type: 'input', required: true },
      key: { name: 'EAB HMAC Key', type: 'input', required: true },
      proxy: proxyField,
    },
  },
  tencent: {
    name: '腾讯云免费SSL',
    class: 2,
    icon: 'tencent.png',
    wildcard: false,
    max_domains: 1,
    cname: false,
    inputs: {
      SecretId: { name: 'SecretId', type: 'input', required: true },
      SecretKey: { name: 'SecretKey', type: 'input', required: true },
      email: { name: '邮箱地址', type: 'input', placeholder: '申请证书时填写的邮箱', required: true },
      proxy: proxyField,
    },
  },
  aliyun: {
    name: '阿里云免费SSL',
    class: 2,
    icon: 'aliyun.png',
    wildcard: false,
    max_domains: 1,
    cname: false,
    inputs: {
      AccessKeyId: { name: 'AccessKeyId', type: 'input', required: true },
      AccessKeySecret: { name: 'AccessKeySecret', type: 'input', required: true },
      proxy: proxyField,
    },
  },
  ucloud: {
    name: 'UCloud免费SSL',
    class: 2,
    icon: 'ucloud.ico',
    wildcard: false,
    max_domains: 1,
    cname: false,
    inputs: {
      PublicKey: { name: '公钥', type: 'input', required: true },
      PrivateKey: { name: '私钥', type: 'input', required: true },
      username: { name: '姓名', type: 'input', placeholder: '申请联系人的姓名', required: true },
      phone: { name: '手机号码', type: 'input', placeholder: '申请联系人的手机号码', required: true },
      email: { name: '邮箱地址', type: 'input', placeholder: '申请联系人的邮箱地址', required: true },
    },
  },
  customacme: {
    name: '自定义ACME',
    class: 1,
    icon: 'ssl.ico',
    wildcard: true,
    max_domains: 100,
    cname: true,
    inputs: {
      directory: { name: 'ACME地址', type: 'input', placeholder: 'ACME Directory 地址', required: true },
      email: { name: '邮箱地址', type: 'input', placeholder: '证书申请邮箱', required: true },
      kid: { name: 'EAB KID', type: 'input', placeholder: '留空则不使用EAB认证' },
      key: { name: 'EAB HMAC Key', type: 'input', placeholder: '留空则不使用EAB认证' },
      proxy: proxyField,
    },
  },
};

export const certClassConfig: Record<number, string> = {
  1: '基于ACME的SSL证书',
  2: '云服务商的SSL证书',
};

const providerMap: Record<string, new (config: Record<string, any>, ext?: any) => CertProvider> = {
  letsencrypt: LetsencryptCert,
  zerossl: ZerosslCert,
  google: GoogleCert,
  litessl: LitesslCert,
  customacme: CustomacmeCert,
  tencent: TencentCert,
  aliyun: AliyunCert,
  ucloud: UcloudCert,
};

export function getCertProvider(type: string, config: Record<string, any>, ext: any = null): CertProvider {
  const C = providerMap[type];
  if (!C) throw new Error('证书类型不存在: ' + type);
  return new C(config, ext);
}