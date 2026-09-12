import { createPrivateKey, KeyObject } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class DirectadminDeploy implements DeployProvider {
  private url: string;
  private username: string;
  private password: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').trim().replace(/\/+$/, '');
    this.username = String(config.username || '').trim();
    this.password = String(config.password || '');

    if (this.url !== '') {
      let parts: URL;
      try {
        parts = new URL(this.url);
      } catch {
        throw new Error('DirectAdmin 面板地址格式无效，必须为不带路径、凭据、查询或片段的 HTTPS 地址');
      }
      const valid =
        parts.protocol === 'https:' &&
        !!parts.hostname &&
        !parts.username &&
        !parts.password &&
        !parts.search &&
        !parts.hash &&
        (parts.pathname === '' || parts.pathname === '/');
      if (!valid) {
        throw new Error('DirectAdmin 面板地址格式无效，必须为不带路径、凭据、查询或片段的 HTTPS 地址');
      }
    }
  }

  private log(text: string) {
    if (this.logger) this.logger(text);
  }

  async check(): Promise<void> {
    this.assertAccountConfig();
    await this.request('GET', '/CMD_API_LOGIN_TEST');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    this.assertAccountConfig();
    const domains = this.parseDomains(String(config.domain || ''));
    if (domains.length === 0) throw new Error('没有设置要部署的 DirectAdmin 域名');
    if (String(fullchain).trim() === '' || String(privatekey).trim() === '') throw new Error('SSL 证书或私钥内容不能为空');

    const key = this.normalizePrivateKeyForDirectAdmin(String(privatekey));
    const certificate = key.replace(/\s+$/g, '') + '\n' + String(fullchain).replace(/^\s+/, '');
    for (const domain of domains) {
      await this.request('POST', '/CMD_API_SSL', {
        domain,
        action: 'save',
        type: 'paste',
        certificate,
      });
      this.log('DirectAdmin 域名 ' + domain + ' 证书部署成功');
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  private assertAccountConfig(): void {
    if (this.url === '' || this.username === '' || this.password === '') {
      throw new Error('请填写 DirectAdmin 面板地址、用户名和认证密码');
    }
  }

  private isValidHostname(s: string): boolean {
    if (s.length > 253) return false;
    const labels = s.split('.');
    for (const l of labels) {
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return false;
    }
    return true;
  }

  private parseDomains(value: string): string[] {
    const domains = value.split(/[\s,]+/).filter(Boolean);
    const result = new Map<string, string>();
    for (const raw of domains) {
      const domain = raw.trim().toLowerCase();
      if (!domain || !this.isValidHostname(domain)) {
        throw new Error('DirectAdmin 域名格式不正确：' + domain);
      }
      result.set(domain, domain);
    }
    return Array.from(result.values());
  }

  private normalizePrivateKeyForDirectAdmin(privatekey: string): string {
    if (!privatekey.trimStart().startsWith('-----BEGIN PRIVATE KEY-----')) {
      return privatekey;
    }

    let key: KeyObject;
    try {
      key = createPrivateKey(privatekey);
    } catch {
      throw new Error('SSL 私钥格式无效');
    }
    if (key.asymmetricKeyType !== 'ec') {
      return privatekey;
    }

    const der = Buffer.from(privatekey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, ''), 'base64');
    if (der.length === 0) {
      throw new Error('ECC PKCS#8 私钥 Base64 内容无效');
    }

    let sec1WithCurve: Buffer;
    try {
      const offset = { offset: 0 };
      const [tag, sequence] = this.readDerElement(der, offset);
      if (tag !== 0x30 || offset.offset !== der.length) {
        throw new Error('PKCS#8 外层结构无效');
      }
      const innerOffset = { offset: 0 };
      const [versionTag] = this.readDerElement(sequence, innerOffset);
      const [algorithmTag, algorithm] = this.readDerElement(sequence, innerOffset);
      const [keyTag, sec1] = this.readDerElement(sequence, innerOffset);
      if (versionTag !== 0x02 || algorithmTag !== 0x30 || keyTag !== 0x04 || sec1.length === 0) {
        throw new Error('PKCS#8 ECC 私钥结构无效');
      }

      const algorithmOffset = { offset: 0 };
      const [algorithmOidTag] = this.readDerElement(algorithm, algorithmOffset);
      const curveStart = algorithmOffset.offset;
      const [curveOidTag] = this.readDerElement(algorithm, algorithmOffset);
      const curveElement = algorithm.subarray(curveStart, algorithmOffset.offset);
      if (algorithmOidTag !== 0x06 || curveOidTag !== 0x06 || curveElement.length === 0) {
        throw new Error('PKCS#8 ECC 曲线参数缺失');
      }

      const sec1Offset = { offset: 0 };
      const [sec1Tag, sec1Content] = this.readDerElement(sec1, sec1Offset);
      if (sec1Tag !== 0x30 || sec1Offset.offset !== sec1.length) {
        throw new Error('SEC1 ECC 私钥结构无效');
      }

      const contentOffset = { offset: 0 };
      const versionStart = contentOffset.offset;
      const [sec1VersionTag] = this.readDerElement(sec1Content, contentOffset);
      const versionElement = sec1Content.subarray(versionStart, contentOffset.offset);
      const keyStart = contentOffset.offset;
      const [privateOctetTag] = this.readDerElement(sec1Content, contentOffset);
      const privateOctetElement = sec1Content.subarray(keyStart, contentOffset.offset);
      if (sec1VersionTag !== 0x02 || privateOctetTag !== 0x04) {
        throw new Error('SEC1 ECC 私钥字段无效');
      }

      const remaining = sec1Content.subarray(contentOffset.offset);
      if (remaining.length > 0 && remaining[0] === 0xa0) {
        sec1WithCurve = sec1;
      } else {
        const parameters = Buffer.concat([Buffer.from([0xa0]), this.encodeDerLength(curveElement.length), curveElement]);
        const newContent = Buffer.concat([versionElement, privateOctetElement, parameters, remaining]);
        sec1WithCurve = Buffer.concat([Buffer.from([0x30]), this.encodeDerLength(newContent.length), newContent]);
      }
    } catch (e: any) {
      throw new Error('ECC 私钥转换为 DirectAdmin 兼容格式失败：' + e.message);
    }

    const b64 = sec1WithCurve.toString('base64');
    const wrapped = (b64.match(/.{1,64}/g) || []).join('\n') + (b64 ? '\n' : '');
    return '-----BEGIN EC PRIVATE KEY-----\n' + wrapped + '-----END EC PRIVATE KEY-----\n';
  }

  private readDerElement(der: Buffer, state: { offset: number }): [number, Buffer] {
    const total = der.length;
    if (state.offset + 2 > total) {
      throw new Error('ASN.1 数据不完整');
    }
    const tag = der[state.offset++];
    const firstLength = der[state.offset++];
    let length: number;
    if ((firstLength & 0x80) === 0) {
      length = firstLength;
    } else {
      const lengthBytes = firstLength & 0x7f;
      if (lengthBytes < 1 || lengthBytes > 4 || state.offset + lengthBytes > total) {
        throw new Error('ASN.1 长度字段无效');
      }
      length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = (length << 8) | der[state.offset++];
      }
    }
    if (length < 0 || state.offset + length > total) {
      throw new Error('ASN.1 内容长度越界');
    }
    const value = der.subarray(state.offset, state.offset + length);
    state.offset += length;
    return [tag, value];
  }

  private encodeDerLength(length: number): Buffer {
    if (length < 0x80) {
      return Buffer.from([length]);
    }
    const bytes: number[] = [];
    while (length > 0) {
      bytes.unshift(length & 0xff);
      length = Math.floor(length / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }

  private async request(method: string, path: string, form?: Record<string, any>): Promise<Record<string, any>> {
    const headers: Record<string, string> = {
      Accept: 'application/x-www-form-urlencoded, application/json',
      'User-Agent': 'DNSManager-DirectAdmin-Deploy/1.0',
      Authorization: 'Basic ' + Buffer.from(this.username + ':' + this.password).toString('base64'),
    };
    let body: string | undefined;
    if (form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(
        Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]))
      ).toString();
    }

    const url = this.url + path;
    let code = 0;
    let text = '';
    try {
      const res = await fetch(url, { method, headers, body, redirect: 'manual' });
      code = res.status;
      text = await res.text();
    } catch (e: any) {
      throw new Error('DirectAdmin 请求失败：' + e.message);
    }

    return this.parseResponse(code, text);
  }

  private parseResponse(httpCode: number, body: string): Record<string, any> {
    if (httpCode === 401 || httpCode === 403) {
      throw new Error('DirectAdmin 认证失败，请检查用户名和认证密码');
    }
    if (httpCode < 200 || httpCode >= 300) {
      throw new Error('DirectAdmin 请求失败（HTTP ' + httpCode + '）');
    }

    const trimmed = body.trim();
    if (trimmed === '') {
      throw new Error('DirectAdmin 响应格式异常：响应内容为空');
    }

    let data: Record<string, any>;
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      try {
        const decoded = JSON.parse(trimmed);
        if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
          throw new Error('DirectAdmin 响应格式异常：JSON 无法解析');
        }
        data = decoded;
      } catch (e: any) {
        if (e.message === 'DirectAdmin 响应格式异常：JSON 无法解析') throw e;
        throw new Error('DirectAdmin 响应格式异常：JSON 无法解析');
      }
    } else {
      data = {};
      for (const [k, v] of new URLSearchParams(body)) {
        data[k] = v;
      }
    }

    if (!('error' in data)) {
      throw new Error('DirectAdmin 响应格式异常：缺少 error 状态字段');
    }

    const error = data.error;
    if (String(error) !== '0' && error !== false) {
      const message = String(data.details ?? data.text ?? '').trim();
      throw new Error(message !== '' ? message : 'DirectAdmin 返回未知错误');
    }
    return data;
  }
}