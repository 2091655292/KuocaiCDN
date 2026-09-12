const TOKEN_KEY = 'dnsmgr_token';
const USER_KEY = 'dnsmgr_user';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function getUser(): any {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setUser(u: any) {
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

export async function api<T = any>(method: string, url: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let fullUrl = '/api' + url;
  let payload: string | undefined;
  if (method === 'GET' && body) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    if (qs.toString()) fullUrl += (url.includes('?') ? '&' : '?') + qs.toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(fullUrl, { method, headers, body: payload });
  const json = await res.json();
  if (res.status === 401) {
    clearToken();
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new Error('未登录');
  }
  return json as T;
}