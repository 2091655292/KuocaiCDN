import { createHmac } from 'node:crypto';
import type { DeployProvider } from '../types.js';

interface HttpResponse {
  code: number;
  redirectUrl: string;
  body: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

export class AmhDeploy implements DeployProvider {
  private url: string;
  private apikey: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '');
    this.apikey = config.apikey || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private stripTags(s: string): string {
    return s.replace(/<[^>]*>/g, '');
  }

  private async request(path: string, postData?: string): Promise<HttpResponse> {
    const url = this.url + path;
    const cookie = 'PHPSESSID=' + createHmac('md5', this.apikey).update('php_sessid=' + this.apikey).digest('hex');
    const headers: Record<string, string> = { 'User-Agent': UA, Cookie: cookie };
    if (postData !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(url, { method: postData !== undefined ? 'POST' : 'GET', headers, body: postData, redirect: 'manual' });
    const body = await res.text();
    return { code: res.status, redirectUrl: res.headers.get('location') || '', body };
  }

  async check(): Promise<void> {
    if (!this.url || !this.apikey) throw new Error('请填写面板地址和接口密钥');
    await this.login();
  }

  private async login(): Promise<string> {
    const path = '/?c=amapi&a=login';
    const expires = Math.floor(Date.now() / 1000) + 120;
    const postData = 'amapi_expires=' + expires;
    const sign = createHmac('sha256', this.apikey).update(postData).digest('hex');
    const response = await this.request(path, postData + '&amapi_sign=' + sign);
    if (response.code === 302 && response.redirectUrl.includes('amh_token=')) {
      const matches = response.redirectUrl.match(/amh_token=([A-Za-z0-9]+)/);
      if (matches) {
        return matches[1];
      }
      throw new Error('面板返回数据异常');
    }
    const errMatch = response.body.match(/<p id="error"[\s\S]*?>([\s\S]*?)<\/p>/);
    if (response.code === 200 && errMatch) {
      throw new Error(this.stripTags(errMatch[1]));
    }
    throw new Error('面板地址无法连接');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (!config.env_name) throw new Error('环境名称不能为空');
    if (!config.vhost_name) throw new Error('网站标识域名不能为空');

    const amhToken = await this.login();

    for (const raw of String(config.vhost_name).split('\n')) {
      const vhostName = raw.trim();
      if (!vhostName) continue;

      const path = '/?c=amssl&a=admin_amssl&envs_name=' + config.env_name + '&vhost_name=' + vhostName + '&ModuleSort=app';
      const params: Record<string, string> = {
        submit_key_crt: 'y',
        key_input1: 'key_input1',
        key_content1: privatekey,
        crt_input1: 'crt_input1',
        crt_content1: fullchain,
        amh_token: amhToken,
      };
      const response = await this.request(path, new URLSearchParams(params).toString());
      if (response.body.includes('<p id="success"')) {
        this.log('网站 ' + vhostName + ' 证书部署成功');
      } else {
        const errMatch = response.body.match(/<p id="error"[\s\S]*?>([\s\S]*?)<\/p>/);
        if (errMatch) {
          let errmsg = this.stripTags(errMatch[1]);
          if (errmsg.includes('<br />')) {
            errmsg = errmsg.split('<br />')[0];
          }
          this.log('网站 ' + vhostName + ' 证书部署失败：' + errmsg);
          throw new Error(errmsg);
        }
        throw new Error('网站 ' + vhostName + ' 证书部署失败：未知错误');
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}