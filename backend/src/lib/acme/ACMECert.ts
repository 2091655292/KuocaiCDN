import { execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACMEException, ACMEv2 } from './ACMEv2.js';

function b64u(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

function pem2der(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

function extractCN(subject: string): string {
  const m = subject.match(/(?:^|,\s*)CN\s*=\s*([^,]+)/i);
  return m ? m[1].trim() : '';
}

export class ACMECert extends ACMEv2 {
  private alternateChains: string[] = [];

  register(termsOfServiceAgreed = false, contacts: string[] = []): string {
    return this._register(termsOfServiceAgreed, contacts);
  }

  registerEAB(termsOfServiceAgreed: boolean, eabKid: string, eabHmac: string, contacts: string[] = []): string {
    if (!this.resources) this.readDirectory();

    const protectedHeader = {
      alg: 'HS256',
      kid: eabKid,
      url: this.unproxiedURL(this.resources!['newAccount']),
    };
    const payload = this.jwkHeader!.jwk;

    const protected64 = b64u(JSON.stringify(protectedHeader));
    const payload64 = b64u(JSON.stringify(payload));

    const hmac = createHmac('sha256', Buffer.from(eabHmac, 'base64url')).update(protected64 + '.' + payload64).digest();

    return this._register(termsOfServiceAgreed, contacts, {
      externalAccountBinding: {
        protected: protected64,
        payload: payload64,
        signature: b64u(hmac),
      },
    });
  }

  private _register(termsOfServiceAgreed = false, contacts: string[] = [], extra: Record<string, any> = {}): string {
    this.log('Registering account');
    const ret = this.request('newAccount', {
      termsOfServiceAgreed: !!termsOfServiceAgreed,
      contact: this.makeContactsArray(contacts),
      ...extra,
    });
    this.log(ret.code == 201 ? 'Account registered' : 'Account already registered');
    return this.kidHeader!.kid!;
  }

  update(contacts: string[] = []): any {
    this.log('Updating account');
    const ret = this.request(this.getAccountID(), { contact: this.makeContactsArray(contacts) });
    this.log('Account updated');
    return ret.body;
  }

  getAccount(): string {
    super.getAccount();
    return this.kidHeader!.kid!;
  }

  setAccount(kid: string): void {
    this.kidHeader!.kid = kid;
  }

  deactivateAccount(): any {
    this.log('Deactivating account');
    const ret = this.deactivate(this.getAccountID());
    this.log('Account deactivated');
    return ret;
  }

  deactivate(url: string): any {
    this.log('Deactivating resource: ' + url);
    const ret = this.request(url, { status: 'deactivated' });
    this.log('Resource deactivated');
    return ret.body;
  }

  getTermsURL(): string {
    if (!this.resources) this.readDirectory();
    if (!this.resources!.meta?.termsOfService) {
      throw new Error('Failed to get Terms Of Service URL');
    }
    return this.resources!.meta.termsOfService;
  }

  getCAAIdentities(): string[] {
    if (!this.resources) this.readDirectory();
    if (!this.resources!.meta?.caaIdentities) {
      throw new Error('Failed to get CAA Identities');
    }
    return this.resources!.meta.caaIdentities;
  }

  keyChange(newAccountKeyPem: string): any {
    this.loadAccountKey(newAccountKeyPem);
    const account = this.getAccountID();
    this.log('Account Key Roll-Over');
    const ret = this.request(
      'keyChange',
      this.jwsEncapsulate('keyChange', { account, oldKey: this.jwkHeader!.jwk }, true),
    );
    this.log('Account Key Roll-Over successful');
    this.loadAccountKey(newAccountKeyPem);
    return ret.body;
  }

  revoke(pem: string): void {
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(pem);
    } catch (e: any) {
      throw new Error('Could not load certificate: ' + e.message);
    }
    this.log('Revoking certificate');
    this.request('revokeCert', { certificate: b64u(cert.raw) });
    this.log('Certificate revoked');
  }

  createOrder(domainConfig: Record<string, any>, settings: any = {}): any {
    settings = this.parseSettings(settings);
    const lowerConfig: Record<string, any> = {};
    for (const [k, v] of Object.entries(domainConfig)) lowerConfig[k.toLowerCase()] = v;
    const domains = Object.keys(lowerConfig);
    let authzDeactivated = false;

    this.log('Creating Order');
    const ret = this.request('newOrder', this.makeOrder(domains, settings));
    const order = ret.body;
    const orderLocation = ret.headers['location'];
    this.log('Order created: ' + orderLocation);
    order.location = orderLocation;

    if (order.status === 'ready' && settings.authz_reuse) {
      this.log('All authorizations already valid, skipping validation altogether');
    } else {
      const authCount = order.authorizations.length;
      const challenges: any[] = [];

      for (let idx = 0; idx < order.authorizations.length; idx++) {
        const authUrl = order.authorizations[idx];
        this.log('Fetching authorization ' + (idx + 1) + ' of ' + authCount);
        const authRet = this.request(authUrl, '');
        const authorization = authRet.body;

        const domain = (authorization.wildcard ? '*.' : '') + authorization.identifier.value;

        if (authorization.status === 'valid') {
          if (settings.authz_reuse) {
            this.log('Authorization of ' + domain + ' already valid, skipping validation');
          } else {
            this.log('Authorization of ' + domain + ' already valid, deactivating authorization');
            this.deactivate(authUrl);
            authzDeactivated = true;
          }
          continue;
        }

        if (lowerConfig[domain] === undefined) {
          this.log('Domain ' + domain + ' not found in domain_config');
          continue;
        }

        const config = lowerConfig[domain];
        const type = config.challenge;

        let challengeUrl = '';
        const challenge = this.parseChallenges(authorization, type, (u: string) => (challengeUrl = u));

        challenges.push({
          domain,
          type,
          auth_url: authUrl,
          challenge_url: challengeUrl,
          key: challenge[0],
          value: challenge[1],
        });
      }

      if (authzDeactivated) {
        this.log('Restarting Order after deactivating already valid authorizations');
        settings.authz_reuse = true;
        return this.createOrder(domainConfig, settings);
      }

      order.challenges = challenges;
    }
    return order;
  }

  async authOrder(order: any): Promise<void> {
    if (order.status !== 'pending' && order.status !== 'ready' && !order.challenges?.length) {
      throw new Error('No challenges available');
    }

    if (order.challenges?.length) {
      for (const opts of order.challenges) {
        this.log('Notifying server for validation of ' + opts.domain);
        this.request(opts.challenge_url, {});

        this.log('Waiting for server challenge validation');
        await this.sleep(1000);

        let body: any;
        if (!(await this.poll('pending', opts.auth_url, (b) => (body = b)))) {
          this.log('Validation failed: ' + opts.domain);
          const error = body.challenges[0].error;
          throw this.createACMEException(error.type, 'Challenge validation failed: ' + error.detail);
        } else {
          this.log('Validation successful: ' + opts.domain);
        }
      }
    }
  }

  async finalizeOrder(domains: string[], order: any, pem: string): Promise<string> {
    let csr: string;
    if (this.isPrivateKey(pem)) {
      this.log('Generating CSR');
      csr = this.generateCSR(pem, domains);
    } else {
      this.log('Using provided CSR');
      csr = pem.startsWith('file://') ? readFileSync(pem.slice(7), 'utf8') : pem;
    }

    this.log('Finalizing Order');
    let ret = this.request(order.finalize, { csr: b64u(pem2der(csr)) });
    ret = ret.body;

    if (ret.certificate) {
      return this.requestCertificate(ret);
    }

    let polled: any = ret;
    if (await this.poll('processing', order.location, (b) => (polled = b))) {
      return this.requestCertificate(polled);
    }

    throw new Error('Order failed');
  }

  async finalizeOrders(domains: string[], order: any, pem: string): Promise<Record<string, string>> {
    const defaultChain = await this.finalizeOrder(domains, order, pem);
    const out: Record<string, string> = {};
    out[this.getTopIssuerCN(defaultChain)] = defaultChain;
    for (const link of this.alternateChains) {
      const chain = this.requestCertificateRaw({ certificate: link }, true);
      out[this.getTopIssuerCN(chain)] = chain;
    }
    this.log('Received ' + Object.keys(out).length + ' chain(s): ' + Object.keys(out).join(', '));
    return out;
  }

  generateCSR(domainKeyPem: string, domains: string[]): string {
    const cn = domains[0] || '';
    const subj = cn && cn.length <= 64 ? '/CN=' + cn : '/';
    const san = domains.map((d) => 'DNS:' + d).join(',');

    const dir = mkdtempSync(join(tmpdir(), 'csr_'));
    const keyFile = join(dir, 'key.pem');
    try {
      writeFileSync(keyFile, domainKeyPem);
      const args = ['req', '-new', '-key', keyFile, '-sha512', '-subj', subj];
      if (san) args.push('-addext', 'subjectAltName=' + san);
      const out = execFileSync('openssl', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      return out;
    } catch (e: any) {
      throw new Error('Could not generate CSR! (' + (e.stderr || e.message) + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  generateRSAKey(bits = 2048): string {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
    return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  generateECKey(curveName = '384'): string {
    const map: Record<string, string> = { '256': 'prime256v1', '384': 'secp384r1', '521': 'secp521r1' };
    const curve = map[curveName] || curveName;
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: curveMap(curve) });
    return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  private isPrivateKey(pem: string): boolean {
    return pem.includes('PRIVATE KEY');
  }

  parseCertificate(certPem: string): any {
    let x: X509Certificate;
    try {
      x = new X509Certificate(certPem);
    } catch (e: any) {
      throw new Error('Could not parse certificate (' + e.message + ')');
    }
    return {
      subject: { CN: extractCN(x.subject) },
      issuer: { CN: extractCN(x.issuer) },
      serialNumberHex: x.serialNumber,
      validFrom_time_t: new Date(x.validFrom).getTime() / 1000,
      validTo_time_t: new Date(x.validTo).getTime() / 1000,
      extensions: {
        subjectAltName: x.subjectAltName || '',
        authorityKeyIdentifier: this.getAKI(certPem),
      },
    };
  }

  private getAKI(certPem: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'aki_'));
    const certFile = join(dir, 'c.pem');
    try {
      writeFileSync(certFile, certPem);
      const out = execFileSync('openssl', ['x509', '-in', certFile, '-noout', '-text'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      const m = out.match(/Authority Key Identifier[:\s]*\n\s*(?:keyid:)?([0-9A-Fa-f:]{10,})/);
      return m ? 'keyid:' + m[1].trim() : '';
    } catch {
      return '';
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  getSAN(pem: string): string[] {
    const ret = this.parseCertificate(pem);
    if (!ret.extensions.subjectAltName) {
      throw new Error('No Subject Alternative Name (SAN) found in certificate');
    }
    const out: string[] = [];
    for (const line of ret.extensions.subjectAltName.split(',')) {
      const parts = line.split(':').map((s: string) => s.trim());
      if (parts[0] === 'DNS') out.push(parts.slice(1).join(':'));
    }
    return out;
  }

  getRemainingDays(certPem: string): number {
    const ret = this.parseCertificate(certPem);
    return (ret.validTo_time_t - Date.now() / 1000) / 86400;
  }

  getRemainingPercent(certPem: string): number {
    const ret = this.parseCertificate(certPem);
    const total = ret.validTo_time_t - ret.validFrom_time_t;
    const used = Date.now() / 1000 - ret.validFrom_time_t;
    return (1 - Math.max(0, Math.min(1, used / total))) * 100;
  }

  getARI(pem: string): { body: any; certId: string | null } {
    const id = this.getARICertID(pem);
    if (!this.resources) this.readDirectory();
    if (!this.resources!.renewalInfo) throw new Error('ARI not supported');
    const ret = this.httpRequest(this.resources!.renewalInfo + '/' + id);
    const sw = ret.body.suggestedWindow;
    if (!sw || !sw.start || !sw.end) throw new Error('ARI suggestedWindow not present');
    sw.start = this.parseDate(sw.start);
    sw.end = this.parseDate(sw.end);
    return { body: ret.body, certId: id };
  }

  private getARICertID(pem: string): string {
    const ret = this.parseCertificate(pem);
    const akiKeyid = ret.extensions.authorityKeyIdentifier || '';
    const aki = akiKeyid.replace(/^keyid:\s*/i, '').replace(/:/g, '');
    if (!aki) throw new Error('authorityKeyIdentifier missing');
    const ser = ret.serialNumberHex;
    if (!ser) throw new Error('serialNumberHex missing');
    return b64u(Buffer.from(aki, 'hex')) + '.' + b64u(Buffer.from(ser, 'hex'));
  }

  private parseDate(str: string): number {
    const t = Date.parse(str.replace(/(\.\d\d)\d+/, '$1'));
    if (Number.isNaN(t)) throw new Error('Failed to parse date: ' + str);
    return t / 1000;
  }

  private parseSettings(opts: any): any {
    if (!opts || typeof opts !== 'object') opts = { authz_reuse: !!opts };
    if (opts.authz_reuse === undefined) opts.authz_reuse = true;
    const allowed = ['authz_reuse', 'notAfter', 'notBefore', 'replaces'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) {
        throw new Error('getCertificateChain(s): Invalid option "' + k + '"');
      }
    }
    return opts;
  }

  private makeOrder(domains: string[], opts: any): any {
    const order: any = {
      identifiers: domains.map((domain) => ({ type: 'dns', value: domain })),
    };
    if (opts.notAfter) order.notAfter = typeof opts.notAfter === 'string' ? opts.notAfter : new Date(opts.notAfter * 1000).toISOString();
    if (opts.notBefore) order.notBefore = typeof opts.notBefore === 'string' ? opts.notBefore : new Date(opts.notBefore * 1000).toISOString();
    if (opts.replaces) {
      order.replaces = opts.replaces;
      this.log('Replacing Certificate: ' + opts.replaces);
    }
    return order;
  }

  private parseChallenges(authorization: any, type: string, setUrl: (u: string) => void): [string | null, string] {
    for (const challenge of authorization.challenges) {
      if (challenge.type !== type) continue;
      setUrl(challenge.url);

      switch (challenge.type) {
        case 'dns-01':
          return ['_acme-challenge.' + authorization.identifier.value, b64u(createHash('sha256').update(this.keyAuthorization(challenge.token)).digest())];
        case 'http-01':
          return ['/.well-known/acme-challenge/' + challenge.token, this.keyAuthorization(challenge.token)];
        case 'tls-alpn-01':
          return [null, createHash('sha256').update(this.keyAuthorization(challenge.token)).digest('hex')];
      }
    }
    throw new Error(
      'Challenge type: "' + type + '" not available, for this challenge use ' +
        authorization.challenges.map((a: any) => '"' + a.type + '"').join(' or '),
    );
  }

  private async poll(initial: string, type: string, setRet: (v: any) => void): Promise<boolean> {
    const maxTries = 10;
    for (let i = 0; i < maxTries; i++) {
      const ret = this.request(type);
      const body = ret.body;
      setRet(body);
      if (body.status !== initial) return body.status === 'valid';
      const s = Math.pow(2, Math.min(i, 6));
      if (i !== maxTries - 1) {
        this.log('Retrying in ' + s + 's');
        await this.sleep(s * 1000);
      }
    }
    throw new Error('Aborted after ' + maxTries + ' tries');
  }

  private requestCertificate(ret: any): string {
    return this.requestCertificateRaw(ret, false);
  }

  private requestCertificateRaw(ret: any, alternate: boolean): string {
    this.log('Requesting ' + (alternate ? 'alternate' : 'default') + ' certificate-chain');
    const res = this.request(ret.certificate, '');
    if (res.headers['content-type'] !== 'application/pem-certificate-chain') {
      throw new Error('Unexpected content-type: ' + res.headers['content-type']);
    }
    const chain: string[] = [];
    for (const cert of this.splitChain(res.body)) {
      const info = this.parseCertificate(cert);
      chain.push('[' + info.issuer.CN + ']');
    }
    if (!alternate) {
      this.alternateChains = res.headers['link']?.alternate || [];
    }
    this.log((alternate ? 'Alternate' : 'Default') + ' certificate-chain retrieved: ' + [...chain].reverse().join(' -> '));
    return res.body;
  }

  private makeContactsArray(contacts: string[] | string): string[] {
    if (!Array.isArray(contacts)) contacts = contacts ? [contacts] : [];
    return contacts.map((c) => 'mailto:' + c);
  }

  private getTopIssuerCN(chain: string): string {
    const tmp = this.splitChain(chain);
    const ret = this.parseCertificate(tmp[tmp.length - 1]);
    return ret.issuer.CN;
  }

  splitChain(chain: string): string[] {
    const delim = '-----END CERTIFICATE-----';
    return chain
      .split(delim)
      .filter((item) => item.includes('-----BEGIN CERTIFICATE-----'))
      .map((item) => item.trim() + '\n' + delim);
  }
}

function curveMap(curve: string): string {
  const m: Record<string, string> = {
    prime256v1: 'prime256v1',
    secp256r1: 'prime256v1',
    secp384r1: 'secp384r1',
    secp521r1: 'secp521r1',
  };
  return m[curve] || curve;
}