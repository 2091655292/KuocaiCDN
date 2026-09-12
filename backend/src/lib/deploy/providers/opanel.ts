import { createHash } from 'node:crypto';
import type { DeployProvider } from '../types.js';

export class OpanelDeploy implements DeployProvider {
  private url: string;
  private key: string;
  private logger: ((txt: string) => void) | null = null;

  constructor(config: Record<string, any>) {
    this.url = String(config.url || '').replace(/\/+$/, '') + '/api/' + (config.version || 'v1');
    this.key = config.key || '';
  }

  private log(txt: string) {
    if (this.logger) this.logger(txt);
  }

  private parseNodeNames(config: Record<string, any>): string[] {
    if (!config.node_name) return [];
    return String(config.node_name)
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private async request(path: string, params?: Record<string, any> | null, nodeName?: string | null): Promise<any> {
    const url = this.url + path;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = createHash('md5').update('1panel' + this.key + timestamp).digest('hex');
    const headers: Record<string, string> = {
      '1Panel-Token': token,
      '1Panel-Timestamp': timestamp,
    };
    if (nodeName) {
      headers['CurrentNode'] = nodeName;
    }
    headers['Content-Type'] = 'application/json';
    const body = params ? JSON.stringify(params) : '{}';
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('请求失败(httpCode=' + res.status + ')');
    }
    if (result.code === 200) {
      return result.data ?? null;
    }
    if (result.message !== undefined) throw new Error(result.message);
    throw new Error('请求失败(httpCode=' + res.status + ')');
  }

  private async deployToNode(fullchain: string, privatekey: string, config: Record<string, any>, nodeName?: string | null): Promise<void> {
    const nodePrefix = nodeName ? '节点 [' + nodeName + '] ' : '';

    if (config.id) {
      const params = {
        sslID: parseInt(config.id),
        type: 'paste',
        certificate: fullchain,
        privateKey: privatekey,
        description: '',
      };
      try {
        await this.request('/websites/ssl/upload', params, nodeName);
        this.log(nodePrefix + '证书ID:' + config.id + '更新成功！');
        return;
      } catch (e: any) {
        throw new Error(nodePrefix + '证书ID:' + config.id + '更新失败：' + e.message);
      }
    }

    const domains: string[] = config.domainList;
    if (!domains || domains.length === 0) throw new Error('没有设置要部署的域名');

    let data: any;
    try {
      data = await this.request('/websites/ssl/search', { page: 1, pageSize: 500, orderBy: 'expire_date', order: 'null' }, nodeName);
      this.log(nodePrefix + '获取证书列表成功(total=' + data.total + ')');
    } catch (e: any) {
      throw new Error(nodePrefix + '获取证书列表失败：' + e.message);
    }

    let success = 0;
    let errmsg: string | null = null;
    if (data.items && data.items.length > 0) {
      for (const row of data.items) {
        if (!row.primaryDomain) continue;
        const certDomains = [row.primaryDomain];
        if (row.domains) certDomains.push(...String(row.domains).split(','));
        const flag = certDomains.some((domain: string) => {
          if (domains.includes(domain)) return true;
          const wildcard = '*' + domain.substring(domain.indexOf('.'));
          return domains.includes(wildcard);
        });
        if (flag) {
          const params = {
            sslID: row.id,
            type: 'paste',
            certificate: fullchain,
            privateKey: privatekey,
            description: '',
          };
          try {
            await this.request('/websites/ssl/upload', params, nodeName);
            this.log(nodePrefix + '证书ID:' + row.id + '更新成功！');
            success++;
          } catch (e: any) {
            errmsg = e.message;
            this.log(nodePrefix + '证书ID:' + row.id + '更新失败：' + errmsg);
          }
        }
      }
    }
    if (success === 0) {
      const params = {
        sslID: 0,
        type: 'paste',
        certificate: fullchain,
        privateKey: privatekey,
        description: '',
      };
      await this.request('/websites/ssl/upload', params, nodeName);
      this.log(nodePrefix + '证书上传成功！');
    }
  }

  async check(): Promise<void> {
    if (!this.url || !this.key) throw new Error('请填写面板地址和接口密钥');
    await this.request('/settings/search');
  }

  async deploy(fullchain: string, privatekey: string, config: Record<string, any>, _info: any): Promise<void> {
    const nodeNames = this.parseNodeNames(config);

    if (config.type === '3') {
      const params = {
        cert: fullchain,
        key: privatekey,
        ssl: 'Enable',
        sslID: null,
        sslType: 'import-paste',
      };

      if (nodeNames.length === 0) {
        try {
          await this.request('/core/settings/ssl/update', params);
          this.log('面板证书更新成功！');
          return;
        } catch (e: any) {
          throw new Error('面板证书更新失败：' + e.message);
        }
      } else {
        let successCount = 0;
        let failCount = 0;
        try {
          await this.request('/core/settings/ssl/update', params);
          this.log('主节点面板证书更新成功！');
          successCount++;
        } catch (e: any) {
          this.log('主节点面板证书更新失败：' + e.message);
          failCount++;
        }
        for (const nodeName of nodeNames) {
          try {
            await this.request('/core/settings/ssl/update', params, nodeName);
            this.log('节点 [' + nodeName + '] 面板证书更新成功！');
            successCount++;
          } catch (e: any) {
            this.log('节点 [' + nodeName + '] 面板证书更新失败：' + e.message);
            failCount++;
          }
        }
        if (failCount > 0 && successCount === 0) {
          throw new Error('所有节点证书更新失败');
        }
        return;
      }
    }

    if (nodeNames.length === 0) {
      await this.deployToNode(fullchain, privatekey, config, null);
    } else {
      let successCount = 0;
      let failCount = 0;
      try {
        await this.deployToNode(fullchain, privatekey, config, null);
        successCount++;
      } catch (e: any) {
        this.log('主节点部署失败：' + e.message);
        failCount++;
      }
      for (const nodeName of nodeNames) {
        try {
          await this.deployToNode(fullchain, privatekey, config, nodeName);
          successCount++;
        } catch (e: any) {
          this.log('节点 [' + nodeName + '] 部署失败：' + e.message);
          failCount++;
        }
      }
      if (failCount > 0 && successCount === 0) {
        throw new Error('所有节点部署失败');
      }
    }
  }

  setLogger(func: (txt: string) => void): void {
    this.logger = func;
  }
}
