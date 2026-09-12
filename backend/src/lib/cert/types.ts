export interface CertInfo {
  private_key: string;
  fullchain: string;
  issuer: string;
  subject: string;
  validFrom: number;
  validTo: number;
}

export interface DnsRecord {
  name: string;
  type: string;
  value: string;
}

export interface CreateOrderResult {
  dnsList: Record<string, DnsRecord[]>;
  order: any;
}

export interface CertProvider {
  register(): Promise<any>;
  buyCert(domainList: string[]): Promise<any>;
  createOrder(domainList: string[], keytype: string, keysize: string, order?: any): Promise<CreateOrderResult>;
  authOrder(domainList: string[], order: any): Promise<void>;
  getAuthStatus(domainList: string[], order: any): Promise<boolean>;
  finalizeOrder(domainList: string[], order: any, keytype: string, keysize: string): Promise<CertInfo>;
  revoke(order: any, pem: string): Promise<void>;
  cancel(order: any): Promise<void>;
  setLogger(func: (txt: string) => void): void;
}