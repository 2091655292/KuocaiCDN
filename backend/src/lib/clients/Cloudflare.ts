export class CloudflareError extends Error {}

export class Cloudflare {
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(private email: string, private apiKey: string, private auth: number) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    params?: Record<string, any>,
    body?: Record<string, any>,
  ): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.auth === 1) {
      headers.Authorization = 'Bearer ' + this.apiKey;
    } else {
      headers['X-Auth-Email'] = this.email;
      headers['X-Auth-Key'] = this.apiKey;
    }

    let url = this.baseUrl + path;
    if (params && Object.keys(params).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined || v === '') continue;
        qs.set(k, String(v));
      }
      if (qs.toString()) url += '?' + qs.toString();
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.success) {
      const err = json.errors?.[0];
      throw new CloudflareError(err?.message || 'Cloudflare 请求失败');
    }
    return json;
  }
}