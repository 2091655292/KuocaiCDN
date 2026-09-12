import { exec } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildPfx } from '../../cert/utils.js';
import type { DeployProvider } from '../types.js';

export class LocalDeploy implements DeployProvider {
  private logger: ((txt: string) => void) | null = null;

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  async check(): Promise<void> {
    return;
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    if (config.format === 'pem') {
      const certDir = dirname(config.pem_cert_file);
      const keyDir = dirname(config.pem_key_file);
      if (!existsSync(certDir)) throw new Error(certDir + ' 目录不存在');
      if (!existsSync(keyDir)) throw new Error(keyDir + ' 目录不存在');
      writeFileSync(config.pem_cert_file, fullchain);
      this.log('证书已保存到：' + config.pem_cert_file);
      writeFileSync(config.pem_key_file, privatekey);
      this.log('私钥已保存到：' + config.pem_key_file);
    } else if (config.format === 'pfx') {
      const dir = dirname(config.pfx_file);
      if (!existsSync(dir)) throw new Error(dir + ' 目录不存在');
      const pfx = buildPfx(fullchain, privatekey, config.pfx_pass || '123456');
      writeFileSync(config.pfx_file, pfx);
      this.log('PFX证书已保存到：' + config.pfx_file);
    }
    if (config.cmd) {
      const cmds = String(config.cmd).split('\n');
      for (const raw of cmds) {
        const cmd = raw.trim();
        if (!cmd) continue;
        this.log('执行命令：' + cmd);
        await this.execAsync(cmd);
        this.log('执行命令成功');
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }

  private execAsync(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error('执行命令失败：' + (stderr || err.message)));
        else resolve(stdout);
      });
    });
  }
}