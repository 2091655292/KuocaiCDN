import { parseCertPem } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class AxisnowDeploy implements DeployProvider {
  private token: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.token = config.token || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private getErrorMessage(result: any, body: string): string {
    let errorMsg = '';
    if (result && Array.isArray(result.errors)) {
      for (const error of result.errors) {
        if (error && typeof error === 'object' && error.message) {
          errorMsg += error.message + '; ';
        } else if (typeof error === 'string') {
          errorMsg += error + '; ';
        }
      }
    }
    errorMsg = errorMsg.replace(/^;\s*|;\s*$/g, '');
    if (!errorMsg && body) {
      errorMsg = body.substring(0, 300);
    }
    if (!errorMsg) errorMsg = '请求失败';
    return errorMsg;
  }

  private async request(method: string, path: string, data?: Record<string, any>): Promise<any> {
    const url = 'https://api.axisnow.io' + path;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + this.token,
    };
    let body: string | undefined;
    if (data) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(data);
    }
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    if (result && result.success) {
      return result.result ?? true;
    }
    throw new Error(this.getErrorMessage(result, text));
  }

  async check(): Promise<void> {
    if (!this.token) throw new Error('Token不能为空');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + this.token,
    };
    const res = await fetch('https://api.axisnow.io/client/v1/certificates', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 200) return;
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }
    throw new Error('Token无效或请求失败:' + this.getErrorMessage(result, text));
  }

  async deploy(fullchain: string, privatekey: string, _config: Record<string, any>, info: any): Promise<void> {
    const certInfo = parseCertPem(fullchain);
    if (!certInfo) throw new Error('证书解析失败');
    const certName = certInfo.subject.split('*.').join('') + '-' + Math.floor(certInfo.validFrom);

    let uuid = info.uuid || null;

    if (uuid) {
      try {
        await this.request('GET', '/client/v1/certificates/' + uuid);
        this.log('证书' + certName + '已存在，UUID:' + uuid);
        const param = {
          name: certName,
          certificate: fullchain,
          private_key: privatekey,
        };
        await this.request('PUT', '/client/v1/certificates/' + uuid, param);
        this.log('证书更新成功，UUID:' + uuid);
      } catch (e: any) {
        this.log('原证书获取或更新失败(' + e.message + ')，将重新上传证书');
        uuid = null;
      }
    }

    if (!uuid) {
      const param = {
        type: 'upload',
        name: certName,
        certificate: fullchain,
        private_key: privatekey,
      };
      let result: any;
      try {
        result = await this.request('POST', '/client/v1/certificates', param);
      } catch (e: any) {
        throw new Error('上传证书失败:' + e.message);
      }
      uuid = result.uuid;
      this.log('上传证书成功，UUID:' + uuid);
    }

    info.uuid = uuid;
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
