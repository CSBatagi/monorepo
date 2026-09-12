import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
export const STEAM_LOGIN_COOKIE = 'csbatagi_steam_login';
const NS = 'http://specs.openid.net/auth/2.0';
const MAX_AGE = 600;
type LoginState = { state: string; next: string; returnTo: string; expires: number };

export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u0020]/.test(value) ? value : '/';
}

export function beginSteamLogin(origin: string, next: string | null, secret: string) {
  if (!secret) throw new Error('Session secret missing');
  const state = randomBytes(32).toString('hex');
  const returnTo = `${origin}/api/auth/steam/callback?state=${state}`;
  const payload: LoginState = { state, next: safeNext(next), returnTo, expires: Date.now() + MAX_AGE * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const cookie = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  const url = new URL(STEAM_OPENID);
  url.search = new URLSearchParams({ 'openid.ns': NS, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': origin, 'openid.identity': `${NS}/identifier_select`, 'openid.claimed_id': `${NS}/identifier_select` }).toString();
  return { cookie, url: url.toString(), maxAge: MAX_AGE };
}

export async function verifySteamLogin(params: URLSearchParams, cookie: string | undefined, origin: string, secret: string, fetcher: typeof fetch = fetch) {
  if (!cookie || !secret) throw new Error('Missing Steam login state');
  const [body, signature, extra] = cookie.split('.');
  const expected = createHmac('sha256', secret).update(body).digest();
  const supplied = Buffer.from(signature || '', 'base64url');
  if (extra !== undefined || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid Steam login state');
  const state: LoginState = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!Number.isFinite(state.expires) || state.expires <= Date.now() || state.expires > Date.now() + MAX_AGE * 1000 || params.get('state') !== state.state || state.returnTo !== `${origin}/api/auth/steam/callback?state=${state.state}`) throw new Error('Expired Steam login state');
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new Error('Duplicate OpenID field');
  const claimed = params.get('openid.claimed_id') || '';
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(claimed);
  const signed = new Set((params.get('openid.signed') || '').split(','));
  if (params.get('openid.ns') !== NS || params.get('openid.mode') !== 'id_res' || params.get('openid.op_endpoint') !== STEAM_OPENID || params.get('openid.return_to') !== state.returnTo || params.get('openid.identity') !== claimed || !match || !['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].every(field => signed.has(field))) throw new Error('Invalid Steam assertion');
  const nonce = params.get('openid.response_nonce') || '';
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.+$/.test(nonce) ? Date.parse(nonce.slice(0,20)) : NaN;
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > MAX_AGE * 1000) throw new Error('Expired Steam assertion');
  const verification = new URLSearchParams();
  for (const [key, value] of params) if (key.startsWith('openid.')) verification.set(key, value);
  verification.set('openid.mode', 'check_authentication');
  const response = await fetcher(STEAM_OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: verification.toString(), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !(await response.text()).split(/\r?\n/).includes('is_valid:true')) throw new Error('Steam verification failed');
  return { steamId: match[1], next: safeNext(state.next) };
}
