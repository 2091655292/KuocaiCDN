import { createHmac } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export class AliyunOSS {
  private AccessKeyId: string;
  private AccessKeySecret: string;
  private Endpoint: string;

  private signKeyList = [
    'acl', 'uploads', 'location', 'cors',
    'logging', 'website', 'referer', 'lifecycle',
    'delete', 'append', 'tagging', 'objectMeta',
    'uploadId', 'partNumber', 'security-token', 'x-oss-security-token',
    'position', 'img', 'style', 'styleName',
    'replication', 'replicationProgress',
    'replicationLocation', 'cname', 'bucketInfo',
    'comp', 'qos', 'live', 'status', 'vod',
    'startTime', 'endTime', 'symlink',
    'x-oss-process', 'response-content-type', 'x-oss-traffic-limit',
    'response-content-language', 'response-expires',
    'response-cache-control', 'response-content-disposition',
    'response-content-encoding', 'udf', 'udfName', 'udfImage',
    'udfId', 'udfImageDesc', 'udfApplication',
    'udfApplicationLog', 'restore', 'callback', 'callback-var', 'qosInfo',
    'policy', 'stat', 'encryption', 'versions', 'versioning', 'versionId', 'requestPayment',
    'x-oss-request-payer', 'sequential',
    'inventory', 'inventoryId', 'continuation-token', 'asyncFetch',
    'worm', 'wormId', 'wormExtend', 'withHashContext',
    'x-oss-enable-md5', 'x-oss-enable-sha1', 'x-oss-enable-sha256',
    'x-oss-hash-ctx', 'x-oss-md5-ctx', 'transferAcceleration',
    'regionList', 'cloudboxes', 'x-oss-ac-source-ip', 'x-oss-ac-subnet-mask', 'x-oss-ac-vpc-id', 'x-oss-ac-forward-allow',
    'metaQuery', 'resourceGroup', 'rtc', 'x-oss-async-process', 'responseHeader',
  ];

  constructor(AccessKeyId: string, AccessKeySecret: string, Endpoint: string) {
    this.AccessKeyId = AccessKeyId;
    this.AccessKeySecret = AccessKeySecret;
    this.Endpoint = Endpoint;
  }

  async addBucketCnameCert(bucket: string, domain: string, certId: string): Promise<any> {
    const body = '<?xml version="1.0" encoding="utf-8"?>' +
      '<BucketCnameConfiguration>' +
      '<Cname>' +
      '<Domain>' + this.xmlEscape(domain) + '</Domain>' +
      '<CertificateConfiguration>' +
      '<CertId>' + certId + '</CertId>' +
      '<Force>true</Force>' +
      '</CertificateConfiguration>' +
      '</Cname>' +
      '</BucketCnameConfiguration>';

    const options = { bucket, key: '' };
    const query = { cname: '', comp: 'add' };
    return await this.request('POST', '/', query, body, options);
  }

  private async request(method: string, path: string, query: Record<string, string>, body: string | null, options: { bucket: string; key: string }): Promise<any> {
    const hostname = options.bucket + '.' + this.Endpoint;
    const queryString = this.toQueryString(query);
    const fullQuery = queryString ? '?' + queryString : '';
    const requestUrl = 'https://' + hostname + path + fullQuery;
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml',
      Date: new Date().toUTCString(),
    };
    headers['Authorization'] = this.getAuthorization(method, path, query, headers, options);

    const res = await fetch(requestUrl, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();

    if (res.status >= 200 && res.status < 300) {
      if (!text) return true;
      return this.xml2array(text);
    }
    const arr = this.xml2array(text);
    if (arr && arr.Message) throw new Error(arr.Message);
    throw new Error('HTTP Code: ' + res.status);
  }

  private toQueryString(params: Record<string, string>): string {
    const keys = Object.keys(params).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    const temp: string[] = [];
    for (const key of keys) {
      const value = params[key];
      if (value && value.length > 0) {
        temp.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      } else {
        temp.push(encodeURIComponent(key));
      }
    }
    return temp.join('&');
  }

  private xml2array(xml: string): any {
    if (!xml) return false;
    const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false });
    const doc = parser.parse(xml);
    return this.simplify(doc);
  }

  private simplify(obj: any): any {
    if (Array.isArray(obj)) return obj.map((v) => this.simplify(v));
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 1 && keys[0] === '#text') return this.simplify(obj['#text']);
      const out: Record<string, any> = {};
      for (const k of keys) out[k] = this.simplify(obj[k]);
      return out;
    }
    return obj;
  }

  private getAuthorization(method: string, _url: string, query: Record<string, string>, headers: Record<string, string>, options: { bucket: string; key: string }): string {
    const date = headers['Date'];
    const resourcePath = this.getResourcePath(options);
    const stringToSign = this.calcStringToSign(method.toUpperCase(), date, headers, resourcePath, query);
    const signature = createHmac('sha1', this.AccessKeySecret).update(stringToSign).digest('base64');
    return 'OSS ' + this.AccessKeyId + ':' + signature;
  }

  private getResourcePath(options: { bucket: string; key: string }): string {
    let resourcePath = '/';
    if (options.bucket.length > 0) resourcePath += options.bucket + '/';
    if (options.key.length > 0) resourcePath += options.key;
    return resourcePath;
  }

  private calcStringToSign(method: string, date: string, headers: Record<string, string>, resourcePath: string, query: Record<string, string>): string {
    let contentMd5 = '';
    let contentType = '';
    const signheaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowk = key.toLowerCase();
      if (lowk.startsWith('x-oss-')) {
        signheaders[lowk] = value;
      } else if (lowk === 'content-md5') {
        contentMd5 = value;
      } else if (lowk === 'content-type') {
        contentType = value;
      }
    }
    const sortedHeaderKeys = Object.keys(signheaders).sort();
    let canonicalizedOSSHeaders = '';
    for (const key of sortedHeaderKeys) {
      canonicalizedOSSHeaders += key + ':' + signheaders[key] + '\n';
    }

    const signquery: Record<string, string> = {};
    for (const key of Object.keys(query)) {
      if (this.signKeyList.includes(key)) {
        signquery[key] = query[key];
      }
    }
    const sortedQueryKeys = Object.keys(signquery).sort();
    const sortedQueryList: string[] = [];
    for (const key of sortedQueryKeys) {
      const value = signquery[key];
      sortedQueryList.push(value && value.length > 0 ? key + '=' + value : key);
    }
    const queryStringSorted = sortedQueryList.join('&');
    let canonicalizedResource = resourcePath;
    if (queryStringSorted) canonicalizedResource += '?' + queryStringSorted;

    return method + '\n' + contentMd5 + '\n' + contentType + '\n' + date + '\n' + canonicalizedOSSHeaders + canonicalizedResource;
  }

  private xmlEscape(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}