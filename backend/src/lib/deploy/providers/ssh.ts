import { Client, ConnectConfig } from 'ssh2';
import { buildPfx } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class SshDeploy implements DeployProvider {
  private config: Record<string, any>;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.config = config;
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private connect(): Promise<Client> {
    const cfg = this.config;
    if (!cfg.host || !cfg.username) throw new Error('必填参数不能为空');
    if (cfg.auth === '1' && !cfg.privatekey) throw new Error('私钥不能为空');
    if (cfg.auth !== '1' && !cfg.password) throw new Error('密码不能为空');

    const connectConfig: ConnectConfig = {
      host: cfg.host,
      port: Number(cfg.port || 22),
      username: cfg.username,
    };
    if (cfg.auth === '1') {
      connectConfig.privateKey = Buffer.from(cfg.privatekey);
      if (cfg.passphrase) connectConfig.passphrase = cfg.passphrase;
    } else {
      connectConfig.password = cfg.password;
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => resolve(conn));
      conn.on('error', (err) => reject(new Error('SSH连接失败：' + err.message)));
      conn.connect(connectConfig);
    });
  }

  async check(): Promise<void> {
    const conn = await this.connect();
    conn.end();
  }

  private writeFile(conn: Client, remotePath: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(new Error('无法创建证书文件：' + err.message));
        const path = remotePath.startsWith('/') ? remotePath : '/' + remotePath;
        sftp.writeFile(path, data, (e) => {
          if (e) reject(new Error('无法写入文件 ' + remotePath + '：' + e.message));
          else resolve();
        });
      });
    });
  }

  private exec(conn: Client, cmd: string): Promise<string> {
    this.log('执行命令：' + cmd);
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(new Error('执行命令失败：' + err.message));
        let output = '';
        let errorOutput = '';
        stream.on('data', (d: Buffer) => (output += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (errorOutput += d.toString()));
        stream.on('close', (code: number) => {
          if (code !== 0 && errorOutput.trim()) {
            reject(new Error('执行命令失败：' + errorOutput.trim()));
          } else {
            this.log('执行命令成功：' + output.trim());
            resolve(output);
          }
        });
      });
    });
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const conn = await this.connect();
    try {
      if (config.cmd_pre) {
        for (const raw of String(config.cmd_pre).split('\n')) {
          const cmd = raw.trim();
          if (cmd) await this.exec(conn, cmd);
        }
      }
      if (config.format === 'pem') {
        await this.writeFile(conn, config.pem_cert_file, Buffer.from(fullchain));
        this.log('证书已保存到：' + config.pem_cert_file);
        await this.writeFile(conn, config.pem_key_file, Buffer.from(privatekey));
        this.log('私钥已保存到：' + config.pem_key_file);
      } else if (config.format === 'pfx') {
        const pfx = buildPfx(fullchain, privatekey, config.pfx_pass || '123456');
        await this.writeFile(conn, config.pfx_file, pfx);
        this.log('PFX证书已保存到：' + config.pfx_file);
      }
      if (config.cmd) {
        for (const raw of String(config.cmd).split('\n')) {
          const cmd = raw.trim();
          if (cmd) await this.exec(conn, cmd);
        }
      }
    } finally {
      conn.end();
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}