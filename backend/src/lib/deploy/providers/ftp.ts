import { Client } from 'basic-ftp';
import { buildPfx } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class FtpDeploy implements DeployProvider {
  private config: Record<string, any>;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.config = config;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private async connect(): Promise<any> {
    const client = new Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: this.config.host,
        port: Number(this.config.port || 21),
        user: this.config.username,
        password: this.config.password,
        secure: this.config.secure === '1' || this.config.secure === 1,
        secureOptions: { rejectUnauthorized: false },
      });
      return client;
    } catch (e: any) {
      client.close();
      throw new Error('FTP连接失败：' + e.message);
    }
  }

  async check(): Promise<void> {
    const client = await this.connect();
    client.close();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const client = await this.connect();
    try {
      if (config.format === 'pem') {
        await client.uploadFrom(Buffer.from(fullchain), config.pem_cert_file);
        this.log('证书已上传到：' + config.pem_cert_file);
        await client.uploadFrom(Buffer.from(privatekey), config.pem_key_file);
        this.log('私钥已上传到：' + config.pem_key_file);
      } else if (config.format === 'pfx') {
        const pfx = buildPfx(fullchain, privatekey, config.pfx_pass || '123456');
        await client.uploadFrom(pfx, config.pfx_file);
        this.log('PFX证书已上传到：' + config.pfx_file);
      }
    } catch (e: any) {
      throw new Error('FTP上传失败：' + e.message);
    } finally {
      client.close();
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}