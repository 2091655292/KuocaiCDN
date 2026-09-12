import { Client, ConnectConfig } from 'ssh2';
import { X509Certificate } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class FnosDeploy implements DeployProvider {
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
    if (!cfg.host || !cfg.port || !cfg.username || !cfg.password) {
      throw new Error('必填参数不能为空');
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(cfg.host)) {
      throw new Error('主机地址不合法');
    }
    const port = Number(cfg.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SSH端口不合法');
    }

    const connectConfig: ConnectConfig = {
      host: cfg.host,
      port,
      username: cfg.username,
      password: cfg.password,
    };

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => resolve(conn));
      conn.on('error', (err) => reject(new Error('SSH连接失败：' + err.message)));
      conn.connect(connectConfig);
    });
  }

  private exec(conn: Client, name: string, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(new Error(name + '执行命令失败'));
        let output = '';
        let errorOutput = '';
        stream.on('data', (d: Buffer) => (output += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (errorOutput += d.toString()));
        stream.on('close', () => {
          if (errorOutput.trim()) {
            if (errorOutput.includes('a password is required')) {
              reject(new Error('权限不足，请先配置 sudo 免密'));
            } else {
              reject(new Error(name + '失败：' + errorOutput.trim()));
            }
          } else {
            if (output.length > 200) {
              resolve(output);
            } else {
              this.log(name + '成功 ' + output.trim());
              resolve(output);
            }
          }
        });
      });
    });
  }

  async check(): Promise<void> {
    const conn = await this.connect();
    conn.end();
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const domains: string[] = config.domainList;
    if (!domains || domains.length === 0) throw new Error('没有设置要部署的域名');

    let certInfo: X509Certificate;
    try {
      certInfo = new X509Certificate(fullchain);
    } catch {
      throw new Error('证书解析失败');
    }

    const conn = await this.connect();
    try {
      const certAll = await this.exec(conn, '获取证书列表', 'cat /usr/trim/etc/network_cert_all.conf');
      let list: any[];
      try {
        list = JSON.parse(certAll);
      } catch {
        throw new Error('获取证书列表失败');
      }

      let success = 0;
      for (const row of list) {
        if (!row.san || !Array.isArray(row.san)) continue;
        const flag = row.san.some((domain: string) => domains.includes(domain));
        if (flag) {
          const certPath = row.certificate;
          const keyPath = row.privateKey;
          const certDir = certPath.replace(/\/[^/]*$/, '');
          const validFrom = Math.floor(new Date(certInfo.validFrom).getTime() / 1000) * 1000;
          const validTo = Math.floor(new Date(certInfo.validTo).getTime() / 1000) * 1000;
          const issuerCN = certInfo.issuer.match(/CN=([^,\n]+)/)?.[1] || '';
          await this.exec(conn, '上传证书文件', "sudo tee " + certPath + " > /dev/null <<'EOF'\n" + fullchain + "\nEOF");
          await this.exec(conn, '上传私钥文件', "sudo tee " + keyPath + " > /dev/null <<'EOF'\n" + privatekey + "\nEOF");
          await this.exec(conn, '刷新目录权限', 'sudo chmod 0755 "' + certDir + '" -R');
          await this.exec(
            conn,
            '更新数据表',
            "cd /tmp && sudo -u postgres psql -d trim_connect -c \"UPDATE cert SET  valid_to=" + validTo + ",valid_from=" + validFrom + ",issued_by='" + issuerCN + "',updated_time=" + Date.now() + " WHERE private_key='" + keyPath + "'\""
          );
          this.log('证书 ' + row.domain + ' 更新成功');
          success++;
        }
      }
      if (success === 0) {
        throw new Error('没有要更新的证书');
      }
      await this.exec(conn, '重启webdav', 'sudo systemctl restart webdav.service');
      await this.exec(conn, '重启smbftpd', 'sudo systemctl restart smbftpd.service');
      await this.exec(conn, '重启trim_nginx', 'sudo systemctl restart trim_nginx.service');
    } finally {
      conn.end();
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
