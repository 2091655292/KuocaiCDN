import { createHash, createHmac, createPrivateKey, createSign, KeyObject } from 'node:crypto';

export class ACMEException extends Error {
  type: string;
  detail: string;
  subproblems: ACMEException[];

  constructor(type: string, detail: string, subproblems: ACMEException[] = []) {
    super(detail);
    this.name = 'ACMEException';
    this.type = type;
    this.detail = detail;
    this.subproblems = subproblems;
  }
}

function b64u(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

function b64uDecode(data: string): Buffer {
  return Buffer.from(data, 'base64url');
}

type Logger = boolean | ((txt: string) => void);

export class ACMEv2 {
  protected logger: Logger = true;
  protected bits = 0;
  protected shaBits = 256;
  protected directory: string;
  protected resources: Record<string, any> | null = null;
  protected jwkHeader: { alg: string; jwk: any } | null = null;
  protected kidHeader: { alg: string; kid: string | null } | null = null;
  protected accountKey: KeyObject | null = null;
  protected thumbprint = '';
  protected nonce: string | null = null;
  protected proxy: number;
  protected proxyConfig: any = null;
  private delayUntil: number | null = null;

  constructor(directory: string, proxy = 0, proxyConfig: any = null) {
    this.directory = directory;
    this.proxy = proxy;
    if (proxy === 2) this.proxyConfig = proxyConfig;
  }

  loadAccountKey(accountKeyPem: string): void {
    let key: KeyObject;
    try {
      key = createPrivateKey(accountKeyPem);
    } catch (e: any) {
      throw new Error('Could not load account key: ' + e.message);
    }
    this.accountKey = key;
    const jwk = key.export({ format: 'jwk' }) as any;

    if (key.asymmetricKeyType === 'ec') {
      const crv = jwk.crv as string;
      this.bits = crv === 'P-256' ? 256 : crv === 'P-384' ? 384 : 521;
      this.shaBits = this.bits === 521 ? 512 : this.bits;
      this.jwkHeader = {
        alg: 'ES' + this.shaBits,
        jwk: { crv: jwk.crv, kty: 'EC', x: jwk.x, y: jwk.y },
      };
    } else if (key.asymmetricKeyType === 'rsa') {
      this.shaBits = 256;
      this.jwkHeader = {
        alg: 'RS256',
        jwk: { e: jwk.e, kty: 'RSA', n: jwk.n },
      };
      const nBytes = Buffer.from(jwk.n, 'base64url').length;
      this.bits = nBytes * 8;
    } else {
      throw new Error('Unsupported key type! Must be RSA or EC key.');
    }

    this.kidHeader = { alg: this.jwkHeader.alg, kid: null };
    this.thumbprint = b64u(createHash('sha256').update(JSON.stringify(this.jwkHeader.jwk)).digest());
  }

  getAccountID(): string {
    if (!this.kidHeader!.kid) this.getAccount();
    return this.kidHeader!.kid!;
  }

  setLogger(value: Logger): void {
    if (typeof value !== 'boolean' && typeof value !== 'function') {
      throw new Error('setLogger: invalid value provided');
    }
    this.logger = value;
  }

  log(txt: string): void {
    if (this.logger === true) console.log(txt);
    else if (this.logger === false) return;
    else (this.logger as (txt: string) => void)(txt);
  }

  protected createACMEException(type: string, detail: string, subproblems: ACMEException[] = []): ACMEException {
    this.log('ACME_Exception: ' + detail + ' (' + type + ')');
    return new ACMEException(type, detail, subproblems);
  }

  protected getAccount(): any {
    this.log('Getting account info');
    const ret = this.request('newAccount', { onlyReturnExisting: true });
    this.log('Account info retrieved');
    return ret;
  }

  protected keyAuthorization(token: string): string {
    return token + '.' + this.thumbprint;
  }

  protected readDirectory(): void {
    this.log('Initializing ACME v2 environment: ' + this.directory);
    const ret = this.httpRequest(this.directory);
    const body = ret.body;
    if (!body || typeof body !== 'object' || ['newNonce', 'newAccount', 'newOrder'].some((k) => body[k] === undefined)) {
      throw new Error('Failed to read directory: ' + this.directory);
    }
    this.resources = body;
    this.log('Initialized');
  }

  protected request(type: string, payload: any = '', retry = false): any {
    if (!this.jwkHeader) throw new Error('use loadAccountKey to load an account key');
    if (!this.resources) this.readDirectory();

    if (type.toLowerCase().startsWith('http')) {
      this.resources!['_tmp'] = type;
      type = '_tmp';
    }

    let ret;
    try {
      ret = this.httpRequest(this.resources![type], JSON.stringify(this.jwsEncapsulate(type, payload)));
    } catch (e) {
      if (!retry && e instanceof ACMEException && e.type === 'urn:ietf:params:acme:error:badNonce') {
        this.log('Replay-Nonce expired, retrying previous request');
        return this.request(type, payload, true);
      }
      if (!retry && e instanceof ACMEException && e.type === 'urn:ietf:params:acme:error:rateLimited' && this.delayUntil !== null) {
        return this.request(type, payload, true);
      }
      throw e;
    }

    if (!this.kidHeader!.kid && type === 'newAccount') {
      this.kidHeader!.kid = this.unproxiedURL(ret.headers['location']);
      this.log('AccountID: ' + this.kidHeader!.kid);
    }

    return ret;
  }

  protected jwsEncapsulate(type: string, payload: any, isInnerJws = false): any {
    let protectedHeader: any;
    if (type === 'newAccount' || isInnerJws) {
      protectedHeader = { ...this.jwkHeader, jwk: this.jwkHeader!.jwk };
    } else {
      this.getAccountID();
      protectedHeader = { ...this.kidHeader };
    }

    if (!isInnerJws) {
      if (!this.nonce) {
        this.httpRequest(this.resources!['newNonce'], false);
      }
      protectedHeader.nonce = this.nonce;
      this.nonce = null;
    }

    if (this.resources![type] === undefined) {
      throw new Error('Resource "' + type + '" not available.');
    }

    protectedHeader.url = this.unproxiedURL(this.resources![type]);

    const protected64 = b64u(JSON.stringify(protectedHeader));
    const payload64 = b64u(typeof payload === 'string' ? payload : JSON.stringify(payload));

    const signedData = protected64 + '.' + payload64;
    const sign = createSign('sha' + this.shaBits);
    sign.update(signedData);
    sign.end();
    let signature: Buffer;
    try {
      signature = sign.sign(this.accountKey!);
    } catch (e: any) {
      throw new Error('Failed to sign payload! (' + e.message + ')');
    }

    const isRSA = this.jwkHeader!.alg.startsWith('R');
    return {
      protected: protected64,
      payload: payload64,
      signature: b64u(isRSA ? signature : this.derToSignature(signature, Math.ceil(this.bits / 8))),
    };
  }

  private derToSignature(der: Buffer, padLen: number): Buffer {
    // ASN.1 DER: SEQUENCE { INTEGER r, INTEGER s } -> r||s, each left-padded to padLen bytes
    let i = 0;
    if (der[0] !== 0x30) throw new Error('ASN.1 SEQUENCE not found!');
    i = der[1] === 0x81 ? 3 : 2;
    if (der[i] !== 0x02) throw new Error('ASN.1 INTEGER 1 not found!');
    const rLen = der[i + 1];
    let r = der.subarray(i + 2, i + 2 + rLen);
    i += 2 + rLen;
    if (der[i] !== 0x02) throw new Error('ASN.1 INTEGER 2 not found!');
    const sLen = der[i + 1];
    let s = der.subarray(i + 2, i + 2 + sLen);
    if (r.length > padLen) r = r.subarray(r.length - padLen);
    if (s.length > padLen) s = s.subarray(s.length - padLen);
    const rPad = Buffer.alloc(padLen);
    const sPad = Buffer.alloc(padLen);
    r.copy(rPad, padLen - r.length);
    s.copy(sPad, padLen - s.length);
    return Buffer.concat([rPad, sPad]);
  }

  protected jsonDecode(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      throw new Error('Could not parse JSON: ' + str);
    }
  }

  protected async httpRequest(url: string, data: any = null): Promise<any> {
    if (this.delayUntil !== null) {
      const delta = this.delayUntil - Date.now() / 1000;
      if (delta > 0) {
        this.log('Delaying ' + Math.round(delta) + 's (rate limit)');
        await this.sleep(delta * 1000);
      }
      this.delayUntil = null;
    }

    url = this.proxiedURL(url);

    const method = data === false ? 'HEAD' : data === null ? 'GET' : 'POST';
    const userAgent = 'ACMECert v3.4.0 (+https://github.com/skoerfgen/ACMECert)';
    const headers: Record<string, string> = {};
    if (data !== null && data !== false) headers['Content-Type'] = 'application/jose+json';

    const init: RequestInit = { method, headers };
    if (data !== null && data !== false) init.body = data as string;
    if (method === 'HEAD') init.method = 'HEAD';

    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e: any) {
      throw new Error('HTTP Request Error: ' + e.message);
    }
    const took = ((Date.now() - start) / 1000).toFixed(2) + 's';

    const respHeaders: Record<string, any> = {};
    const replayNonce = res.headers.get('replay-nonce');
    const location = res.headers.get('location');
    const retryAfter = res.headers.get('retry-after');
    const contentType = res.headers.get('content-type');
    const link = res.headers.get('link');

    if (replayNonce) respHeaders['replay-nonce'] = replayNonce;
    if (location) respHeaders['location'] = location;
    if (contentType) respHeaders['content-type'] = contentType.split(';')[0].trim();

    if (link) {
      respHeaders['link'] = {};
      for (const m of link.matchAll(/<([^>]*)>\s*;\s*rel="?([^";,]*)"?/g)) {
        const rel = m[2];
        if (!respHeaders['link'][rel]) respHeaders['link'][rel] = [];
        respHeaders['link'][rel].push(m[1].trim());
      }
    }

    const code = String(res.status);
    this.log('  ' + url + ' [' + code + '] (' + took + ')');

    if (replayNonce) this.nonce = replayNonce;

    if (retryAfter) {
      const num = Number(retryAfter);
      let until: number;
      if (retryAfter.trim() !== '' && Number.isFinite(num)) {
        until = Date.now() / 1000 + Math.ceil(num);
      } else {
        until = Date.parse(retryAfter) / 1000;
      }
      const tmp = until - Date.now() / 1000;
      if (!(tmp > 300 || tmp < 1 || Number.isNaN(tmp))) {
        this.delayUntil = until;
      }
    }

    let body: any = await res.text();

    if (contentType) {
      const ct = contentType.split(';')[0].trim();
      if (ct === 'application/json') {
        if (code[0] === '2') {
          body = this.jsonDecode(body);
          if (body && body.error && !(body.status && body.status === 'valid')) {
            this.handleError(body.error);
          }
        } else {
          body = this.jsonDecode(body);
          this.handleError(body);
        }
      } else if (ct === 'application/problem+json') {
        body = this.jsonDecode(body);
        this.handleError(body);
      }
    }

    if (code[0] !== '2') {
      throw new Error('Invalid HTTP-Status-Code received: ' + code + ': ' + JSON.stringify(body));
    }

    return { code, headers: respHeaders, body };
  }

  private handleError(error: any): never {
    const subproblems = (error.subproblems || [])?.map((sp: any) =>
      this.createACMEException(
        sp.type,
        `${sp.identifier?.value ? '"' + sp.identifier.value + '": ' : ''}${sp.detail}`,
      ),
    );
    throw this.createACMEException(error.type, error.detail, subproblems);
  }

  protected proxiedURL(url: string): string {
    if (this.proxy === 2 && this.proxyConfig) {
      return url.split(this.proxyConfig.origin).join(this.proxyConfig.proxy);
    }
    return url;
  }

  protected unproxiedURL(url: string): string {
    if (this.proxy === 2 && this.proxyConfig) {
      return url.split(this.proxyConfig.proxy).join(this.proxyConfig.origin);
    }
    return url;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}