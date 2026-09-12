export interface DeployProvider {
  check(): Promise<void>;
  deploy(fullchain: string, privatekey: string, config: Record<string, any>, info: any): Promise<void>;
  setLogger(func: (txt: string) => void): void;
}