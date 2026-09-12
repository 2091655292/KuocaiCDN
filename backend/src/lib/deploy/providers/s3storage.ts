import { createHash, createHmac } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class S3storageDeploy implements DeployProvider {
  private AccessKeyId: string;
  private SecretAccessKey: string;
  private endpoint: string;
  private region: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.AccessKeyId = config.AccessKeyId || '';
    this.SecretAccessKey = config.SecretAccessKey || '';
    this.endpoint = String(config.endpoint || '').replace(/\/+$/, '');
    this.region = config.region || 'us-east-1';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private sha256Hex(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  private hmacSha256(key: string | Buffer, msg: string): Buffer {
    return createHmac('sha256', key).update(msg).digest();
  }

  async check(): Promise<void> {
    if (!this.AccessKeyId || !this.SecretAccessKey || !this.endpoint) {
      throw new Error('必填参数不能为空');
    }
    await this.s3Request('GET', '/', null, null);
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const bucket = config.bucket;
    if (!bucket) throw new Error('存储桶名称不能为空');

    const certPath = String(config.cert_path || '').replace(/^\/+/, '').replace(/\/+$/, '');
    const keyPath = String(config.key_path || '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!certPath || !keyPath) throw new Error('证书和私钥保存路径不能为空');

    await this.putObject(bucket, certPath, fullchain);
    this.log('证书已上传到：s3://' + bucket + '/' + certPath);

    await this.putObject(bucket, keyPath, privatekey);
    this.log('私钥已上传到：s3://' + bucket + '/' + keyPath);
  }

  private async putObject(bucket: string, key: string, content: string): Promise<void> {
    await this.s3Request('PUT', '/' + bucket + '/' + key, content, 'application/x-pem-file');
  }

  private async s3Request(method: string, path: string, body: string | null, contentType: string | null): Promise<string> {
    const time = Math.floor(Date.now() / 1000);
    const date = this.formatDate(time);
    const shortDate = date.slice(0, 8);

    const rawEndpoint = this.endpoint;
    const host = rawEndpoint.replace(/^https?:\/\//, '');
    let scheme = rawEndpoint.startsWith('https://') ? 'https' : 'http';
    if (!rawEndpoint.includes('://')) scheme = 'https';

    const payloadHash = this.sha256Hex(body ?? '');

    const headers: Record<string, string> = {
      Host: host,
      'X-Amz-Date': date,
      'X-Amz-Content-Sha256': payloadHash,
    };
    if (contentType) headers['Content-Type'] = contentType;

    const authorization = this.generateSign(method, path, {}, headers, body ?? '', date, shortDate);
    headers.Authorization = authorization;

    const url = scheme + '://' + host + path;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== null && body !== '' ? body : undefined,
    });
    const text = await res.text();

    if (res.status >= 200 && res.status < 300) return text;

    let errmsg = 'HTTP Code: ' + res.status;
    if (text) {
      const m = text.match(/<Message>[\s\S]*?<\/Message>/);
      if (m) errmsg = m[0].replace(/<\/?Message>/g, '');
    }
    throw new Error(errmsg);
  }

  private generateSign(
    method: string,
    path: string,
    query: Record<string, string>,
    headers: Record<string, string>,
    body: string,
    date: string,
    shortDate: string,
  ): string {
    const algorithm = 'AWS4-HMAC-SHA256';

    const canonicalUri = this.getCanonicalURI(path);
    const canonicalQueryString = this.getCanonicalQueryString(query);
    const [canonicalHeaders, signedHeaders] = this.getCanonicalHeaders(headers);
    const hashedPayload = this.sha256Hex(body);

    const canonicalRequest =
      method + '\n' + canonicalUri + '\n' + canonicalQueryString + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;

    const credentialScope = shortDate + '/' + this.region + '/s3/aws4_request';
    const stringToSign = algorithm + '\n' + date + '\n' + credentialScope + '\n' + this.sha256Hex(canonicalRequest);

    const kDate = this.hmacSha256('AWS4' + this.SecretAccessKey, shortDate);
    const kRegion = this.hmacSha256(kDate, this.region);
    const kService = this.hmacSha256(kRegion, 's3');
    const kSigning = this.hmacSha256(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return algorithm + ' Credential=' + this.AccessKeyId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  }

  private escape(str: string): string {
    return encodeURIComponent(str).replace(/\*/g, '%2A');
  }

  private getCanonicalURI(path: string): string {
    if (!path) return '/';
    return path
      .split('/')
      .map((item) => this.escape(item))
      .join('/');
  }

  private getCanonicalQueryString(params: Record<string, string>): string {
    const keys = Object.keys(params).sort();
    return keys.map((k) => this.escape(k) + '=' + this.escape(params[k])).join('&');
  }

  private getCanonicalHeaders(oldHeaders: Record<string, string>): [string, string] {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(oldHeaders)) headers[k.toLowerCase()] = v.trim();
    const keys = Object.keys(headers).sort();

    let canonicalHeaders = '';
    let signedHeaders = '';
    for (const k of keys) {
      canonicalHeaders += k + ':' + headers[k] + '\n';
      signedHeaders += k + ';';
    }
    signedHeaders = signedHeaders.slice(0, -1);
    return [canonicalHeaders, signedHeaders];
  }

  private formatDate(time: number): string {
    const d = new Date(time * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}