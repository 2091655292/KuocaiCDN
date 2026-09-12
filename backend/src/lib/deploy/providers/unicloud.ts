import { createHmac, createCipheriv, randomBytes, publicEncrypt, constants } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class UnicloudDeploy implements DeployProvider {
  private username: string;
  private password: string;
  private deviceId: string;
  private token = '';
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.username = config.username || '';
    this.password = config.password || '';
    let digits = '';
    for (let i = 0; i < 7; i++) digits += Math.floor(Math.random() * 10);
    this.deviceId = String(Date.now()) + digits;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private getClientInfo(appId: string, appName: string, appVersion = '1.0.0', appVersionCode = '100') {
    return {
      PLATFORM: 'web',
      OS: 'windows',
      APPID: appId,
      DEVICEID: this.deviceId,
      scene: 1001,
      appId: appId,
      appLanguage: 'zh-Hans',
      appName: appName,
      appVersion: appVersion,
      appVersionCode: appVersionCode,
      browserName: 'chrome',
      browserVersion: '132.0.0.0',
      deviceId: this.deviceId,
      deviceModel: 'PC',
      deviceType: 'pc',
      hostName: 'chrome',
      hostVersion: '132.0.0.0',
      osName: 'windows',
      osVersion: '10 x64',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      uniCompilerVersion: '5.23',
      uniPlatform: 'web',
      uniRuntimeVersion: '5.23',
      locale: 'zh-Hans',
      LOCALE: 'zh-Hans',
    };
  }

  private sign(data: Record<string, any>, key: string): string {
    const keys = Object.keys(data).sort();
    const signstr = keys.map((k) => k + '=' + data[k]).join('&');
    return createHmac('md5', key).update(signstr).digest('hex');
  }

  private async invoke(
    url: string,
    bizParams: Record<string, any>,
    spaceId: string,
    signKey: string,
    clientInfo: any,
    extraHeaders: Record<string, string>
  ): Promise<any> {
    const params = {
      method: 'serverless.function.runtime.invoke',
      params: JSON.stringify(bizParams),
      spaceId,
      timestamp: Date.now(),
    };
    const sign = this.sign(params, signKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Info': JSON.stringify(clientInfo),
        'X-Serverless-Sign': sign,
        ...extraHeaders,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(text);
    }
  }

  private createPasswordEnvelope(keyData: any): Record<string, any> {
    if (keyData.algorithm !== 'RSA-OAEP-256+A256GCM') {
      throw new Error('不支持的密码加密算法:' + keyData.algorithm);
    }

    const key = randomBytes(32);
    const iv = randomBytes(12);
    const header = {
      version: keyData.version,
      algorithm: keyData.algorithm,
      keyId: keyData.keyId,
      challengeId: keyData.challengeId,
    };
    const payload = {
      action: 'login',
      challengeId: keyData.challengeId,
      issuedAt: Date.now(),
      password: this.password,
      email: this.username,
    };
    const aad = JSON.stringify(header);
    const plaintext = JSON.stringify(payload);

    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();

    const encryptedKey = publicEncrypt(
      {
        key: keyData.publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        mgf1HashAlgorithm: 'sha256',
      },
      key
    );

    return {
      ...header,
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  private async login(): Promise<string> {
    const url = 'https://account.dcloud.net.cn/client';
    const clientInfo = this.getClientInfo('__UNI__unicloud_console', '账号中心');
    const signKey = 'ba461799-fde8-429f-8cc4-4b6d306e2339';
    const headers = {
      Origin: 'https://account.dcloud.net.cn',
      Referer: 'https://account.dcloud.net.cn/',
    };

    const bizParams1 = {
      functionTarget: 'uni-id-co',
      functionArgs: {
        method: 'createPasswordChallenge',
        params: [
          {
            action: 'login',
            resetAppId: '__UNI__unicloud_console',
            resetUniPlatform: 'web',
          },
        ],
        clientInfo,
      },
    };
    const result1 = await this.invoke(url, bizParams1, 'uni-id-server', signKey, clientInfo, headers);
    if (!(result1.success === true)) {
      throw new Error('获取密码加密密钥失败:' + JSON.stringify(result1));
    }
    const keyData = result1.data;

    const passwordEnvelope = this.createPasswordEnvelope(keyData);

    const bizParams2 = {
      functionTarget: 'uni-id-co',
      functionArgs: {
        method: 'login',
        params: [
          {
            captcha: '',
            resetAppId: '__UNI__unicloud_console',
            resetUniPlatform: 'web',
            isReturnToken: false,
            passwordEnvelope,
          },
        ],
        clientInfo,
      },
    };
    const result2 = await this.invoke(url, bizParams2, 'uni-id-server', signKey, clientInfo, headers);
    if (result2.success === true) {
      if (result2.data.errCode === 0) {
        return result2.data.newToken.token;
      }
      throw new Error('登录失败:' + result2.data.errMsg);
    }
    throw new Error('登录失败:' + JSON.stringify(result2));
  }

  private async getToken(): Promise<string> {
    const uniIdToken = await this.login();
    const url = 'https://unicloud.dcloud.net.cn/client';
    const clientInfo = this.getClientInfo('__UNI__unicloud_console', 'uniCloud控制台');
    const bizParams = {
      functionTarget: 'uni-cloud-kernel',
      functionArgs: {
        action: 'user/getUserToken',
        data: { isLogin: true },
        clientInfo,
        uniIdToken,
      },
    };
    const result = await this.invoke(url, bizParams, 'dc-6nfabcn6ada8d3dd', '4c1f7fbf-c732-42b0-ab10-4634a8bbe834', clientInfo, {
      Origin: 'https://account.dcloud.net.cn',
      Referer: 'https://account.dcloud.net.cn/',
      'X-Client-Token': uniIdToken,
    });
    if (result.success === true) {
      if (result.data.code === 0) {
        if (result.data.data && result.data.data.ret === 0) {
          this.token = result.data.data.data.token;
          return this.token;
        }
        throw new Error('获取token失败:' + (result.data.data ? result.data.data.desc : ''));
      }
      throw new Error('获取token失败:' + JSON.stringify(result.data));
    }
    throw new Error('获取token失败:' + JSON.stringify(result));
  }

  async check(): Promise<void> {
    if (!this.username || !this.password) throw new Error('账号或密码不能为空');
    await this.login();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.domains) throw new Error('绑定的域名不能为空');
    await this.getToken();

    const url = 'https://unicloud-api.dcloud.net.cn/unicloud/api/host/create-domain-with-cert';
    for (const domain of String(config.domains).split(',')) {
      if (!domain) continue;
      const params = {
        appid: '',
        provider: config.provider,
        spaceId: config.spaceId,
        domain,
        cert: encodeURIComponent(fullchain),
        key: encodeURIComponent(privatekey),
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Token: this.token },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      let result: any;
      try {
        result = JSON.parse(text);
      } catch {
        result = null;
      }
      if (result && result.ret === 0) {
        this.log('域名:' + domain + ' 证书更新成功！');
      } else if (result && result.desc) {
        throw new Error('域名:' + domain + ' 证书更新失败:' + result.desc);
      } else {
        throw new Error('域名:' + domain + ' 证书更新失败:' + text);
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
