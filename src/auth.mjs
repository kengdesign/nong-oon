// Server-side LINE Login. Never trust client profile fields or decode unverified JWTs.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OAUTH_TTL_MS = 10 * 60 * 1000;
export const MAX_AUTH_RATE_ROWS = 5000;
export const MAX_OAUTH_STATES = 5000;
export const LOGIN_STARTS_PER_MINUTE = 10;
const SESSION_COOKIE = '__Host-nongoon';
const LOGIN_COOKIE = '__Host-nongoon-login';
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const lineId = value => typeof value === 'string' && /^U[0-9a-f]{32}$/.test(value);
export class AuthError extends Error {
  constructor(code, status = 401) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new AuthError(code, status); };
function appOrigin(env) {
  let parsed;
  try { parsed = new URL(env.APP_ORIGIN); } catch { fail('AUTH_NOT_CONFIGURED', 503); }
  if (parsed.protocol !== 'https:' || parsed.origin !== env.APP_ORIGIN
    || parsed.username || parsed.password) fail('AUTH_NOT_CONFIGURED', 503);
  return parsed.origin;
}
function configured(env) {
  const origin = appOrigin(env);
  if (typeof env.LINE_LOGIN_CHANNEL_ID !== 'string' || !/^\d{5,20}$/.test(env.LINE_LOGIN_CHANNEL_ID)
    || typeof env.LINE_LOGIN_CHANNEL_SECRET !== 'string' || !env.LINE_LOGIN_CHANNEL_SECRET.trim())
    fail('AUTH_NOT_CONFIGURED', 503);
  return origin;
}
function cookie(request, name) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  // Duplicate cookies must not create differing interpretations at proxies/app.
  return values.length === 1 && token(values[0]) ? values[0] : null;
}
const setCookie = (name, value, age) => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}
const json = (status, value, cookies = []) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
};
function validNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('AUTH_UNAVAILABLE', 503);
}
async function run(statement) {
  const result = await statement.run();
  if (result?.success !== true) fail('AUTH_UNAVAILABLE', 503);
  return result;
}
async function first(statement) {
  return statement.first();
}
async function throttleLogin(request, env, now) {
  // Cloudflare overwrites CF-Connecting-IP at ingress. Do not deploy behind an
  // unsanitized proxy that lets clients choose it. Missing/invalid IP shares one
  // conservative bucket; it never disables throttling.
  const header = request.headers.get('cf-connecting-ip');
  const address = typeof header === 'string' && header.length <= 64
    && /^[0-9a-f:.]+$/i.test(header) ? header.toLowerCase() : 'unavailable';
  const day = 24 * 60 * 60 * 1000;
  const dayEnd = (Math.floor(now / day) + 1) * day;
  const cleanup = await env.DB.batch([
    env.DB.prepare(`DELETE FROM auth_rate_limits WHERE rate_hash IN
      (SELECT rate_hash FROM auth_rate_limits WHERE expires_at<=? ORDER BY expires_at LIMIT 100)`).bind(now),
    env.DB.prepare(`DELETE FROM oauth_states WHERE state_hash IN
      (SELECT state_hash FROM oauth_states WHERE expires_at<=? ORDER BY expires_at LIMIT 100)`).bind(now),
  ]);
  if (!Array.isArray(cleanup) || cleanup.length !== 2 || cleanup.some(value => value?.success !== true))
    fail('AUTH_UNAVAILABLE', 503);
  const saltResult = await env.DB.prepare(`INSERT INTO auth_rate_salt(singleton,salt,expires_at) VALUES(1,?,?)
    ON CONFLICT(singleton) DO UPDATE SET
      salt=CASE WHEN auth_rate_salt.expires_at<=? THEN excluded.salt ELSE auth_rate_salt.salt END,
      expires_at=MAX(auth_rate_salt.expires_at,excluded.expires_at) RETURNING salt`)
    .bind(random(), dayEnd, now).all();
  const salt = saltResult?.results?.[0]?.salt;
  if (saltResult?.success !== true || !token(salt)) fail('AUTH_UNAVAILABLE', 503);
  const minute = Math.floor(now / 60000);
  const rateHash = await hash(`${salt}:${minute}:${address}`);
  const allowed = await env.DB.prepare(`INSERT INTO auth_rate_limits(rate_hash,attempts,expires_at)
    SELECT ?,1,? WHERE (SELECT COUNT(*) FROM auth_rate_limits)<?
      OR EXISTS(SELECT 1 FROM auth_rate_limits WHERE rate_hash=?)
    ON CONFLICT(rate_hash) DO UPDATE SET attempts=auth_rate_limits.attempts+1
      WHERE auth_rate_limits.attempts<? RETURNING attempts`)
    .bind(rateHash, (minute + 1) * 60000, MAX_AUTH_RATE_ROWS, rateHash, LOGIN_STARTS_PER_MINUTE).all();
  if (allowed?.success !== true) fail('AUTH_UNAVAILABLE', 503);
  if (!Array.isArray(allowed.results) || allowed.results.length !== 1) fail('LOGIN_RATE_LIMITED', 429);
}
async function boundedJson(response) {
  const max = 64 * 1024;
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) fail('LOGIN_PROVIDER_UNAVAILABLE', 502);
  if (!response.body) fail('LOGIN_PROVIDER_UNAVAILABLE', 502);
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel(); fail('LOGIN_PROVIDER_UNAVAILABLE', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('LOGIN_PROVIDER_UNAVAILABLE', 502); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('LOGIN_PROVIDER_UNAVAILABLE', 502);
  return result;
}
async function linePost(fetcher, endpoint, fields) {
  let response;
  try {
    response = await fetcher(`https://api.line.me/oauth2/v2.1/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(), redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
  } catch { fail('LOGIN_PROVIDER_UNAVAILABLE', 502); }
  if (!response.ok) {
    // Do not include response body: it can contain tokens or provider details.
    await response.body?.cancel();
    fail(response.status >= 500 || response.status === 429 ? 'LOGIN_PROVIDER_UNAVAILABLE' : 'LOGIN_REJECTED',
      response.status >= 500 || response.status === 429 ? 502 : 401);
  }
  return boundedJson(response);
}
/** Trusted session identity only. Caller must check API feature gates separately. */
export async function authenticate(request, env, { now = Date.now() } = {}) {
  validNow(now);
  const sessionToken = cookie(request, SESSION_COOKIE);
  if (!sessionToken) fail('UNAUTHENTICATED');
  try {
    const row = await first(env.DB.prepare(`SELECT s.actor_id AS actorId, s.csrf
      FROM sessions s JOIN accounts a ON a.actor_id=s.actor_id
      WHERE s.session_hash=? AND s.expires_at>? AND a.blocked_at IS NULL`)
      .bind(await hash(sessionToken), now));
    if (!row || !lineId(row.actorId) || !token(row.csrf)) fail('UNAUTHENTICATED');
    return { actorId: row.actorId, csrf: row.csrf };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    fail('AUTH_UNAVAILABLE', 503);
  }
}
/** Mutations require both same-origin provenance and the session CSRF capability. */
export function requireCsrf(request, env, identity) {
  const origin = appOrigin(env);
  if (request.headers.get('origin') !== origin || new URL(request.url).origin !== origin
    || request.headers.get('sec-fetch-site') === 'cross-site'
    || !token(identity?.csrf) || request.headers.get('x-csrf-token') !== identity.csrf)
    fail('CSRF_REJECTED', 403);
}
async function login(request, env, now) {
  const origin = configured(env);
  if (new URL(request.url).origin !== origin) fail('INVALID_ORIGIN', 400);
  if (request.headers.get('sec-fetch-site') === 'cross-site') fail('CSRF_REJECTED', 403);
  await throttleLogin(request, env, now);
  const state = random(), browser = random(), nonce = random(), verifier = random();
  const challengeBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
  const challenge = btoa(String.fromCharCode(...challengeBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const stored = await run(env.DB.prepare(`INSERT INTO oauth_states(state_hash,browser_hash,nonce,code_verifier,expires_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM oauth_states)<?`)
    .bind(await hash(state), await hash(browser), nonce, verifier, now + OAUTH_TTL_MS, MAX_OAUTH_STATES));
  if (stored.meta?.changes !== 1) fail('LOGIN_CAPACITY_REACHED', 503);
  const target = new URL('https://access.line.me/oauth2/v2.1/authorize');
  target.search = new URLSearchParams({ response_type: 'code', client_id: env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: `${origin}/auth/callback`, state, scope: 'openid', nonce,
    code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return redirect(target.href, [setCookie(LOGIN_COOKIE, browser, OAUTH_TTL_MS / 1000)]);
}
async function callback(request, env, now, fetcher) {
  const origin = configured(env);
  const url = new URL(request.url);
  if (url.origin !== origin) fail('INVALID_ORIGIN', 400);
  const state = url.searchParams.get('state'), browser = cookie(request, LOGIN_COOKIE);
  if (!token(state) || !browser || url.searchParams.getAll('state').length !== 1) fail('LOGIN_STATE_REJECTED');
  // Consume before external I/O. A retry must start a new login; concurrent callbacks
  // can never exchange the same state twice, including a failed provider response.
  const result = await env.DB.prepare(`DELETE FROM oauth_states
    WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING nonce,code_verifier`)
    .bind(await hash(state), await hash(browser), now).all();
  if (result?.success !== true || !Array.isArray(result.results) || result.results.length !== 1)
    fail('LOGIN_STATE_REJECTED');
  const flow = result.results[0];
  if (url.searchParams.has('error')) return redirect(`${origin}/?login=cancelled`, [setCookie(LOGIN_COOKIE, '', 0)]);
  const code = url.searchParams.get('code');
  if (typeof code !== 'string' || !code.length || code.length > 2048 || /[\u0000-\u0020\u007f]/.test(code)
    || url.searchParams.getAll('code').length !== 1) fail('LOGIN_REJECTED');
  const tokens = await linePost(fetcher, 'token', { grant_type: 'authorization_code', code,
    redirect_uri: `${origin}/auth/callback`, client_id: env.LINE_LOGIN_CHANNEL_ID,
    client_secret: env.LINE_LOGIN_CHANNEL_SECRET, code_verifier: flow.code_verifier });
  if (typeof tokens.id_token !== 'string' || tokens.id_token.length < 1 || tokens.id_token.length > 16384)
    fail('LOGIN_REJECTED');
  const claims = await linePost(fetcher, 'verify', { id_token: tokens.id_token,
    client_id: env.LINE_LOGIN_CHANNEL_ID, nonce: flow.nonce });
  const seconds = Math.floor(now / 1000);
  if (claims.iss !== 'https://access.line.me' || claims.aud !== env.LINE_LOGIN_CHANNEL_ID
    || !lineId(claims.sub) || claims.nonce !== flow.nonce || !Number.isSafeInteger(claims.exp)
    || claims.exp <= seconds || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 60
    || claims.iat > claims.exp || claims.iat < seconds - OAUTH_TTL_MS / 1000 - 60)
    fail('LOGIN_REJECTED');
  const sessionToken = random(), csrf = random();
  const previousSession = cookie(request, SESSION_COOKIE);
  const statements = [
    env.DB.prepare(`INSERT INTO accounts(actor_id,line_user_id,blocked_at,created_at)
      VALUES(?,?,NULL,?) ON CONFLICT(actor_id) DO NOTHING`).bind(claims.sub, claims.sub, now),
    env.DB.prepare(`INSERT INTO sessions(session_hash,actor_id,csrf,created_at,expires_at)
      SELECT ?,actor_id,?,?,? FROM accounts WHERE actor_id=? AND line_user_id=? AND blocked_at IS NULL`)
      .bind(await hash(sessionToken), csrf, now, now + SESSION_TTL_MS, claims.sub, claims.sub),
  ];
  if (previousSession) statements.push(env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(await hash(previousSession)));
  const saved = await env.DB.batch(statements);
  if (!Array.isArray(saved) || saved.length !== statements.length || saved.some(value => value.success !== true))
    fail('AUTH_UNAVAILABLE', 503);
  if (saved[1].meta?.changes !== 1) fail('ACCOUNT_BLOCKED', 403);
  return redirect(`${origin}/`, [setCookie(SESSION_COOKIE, sessionToken, SESSION_TTL_MS / 1000), setCookie(LOGIN_COOKIE, '', 0)]);
}
/** Known auth route -> Response; unrelated route -> null. No side effects on unknown routes. */
export async function handleAuth(request, env = {}, { now = Date.now(), fetcher = fetch } = {}) {
  const path = new URL(request.url).pathname;
  const methods = { '/auth/login': 'GET', '/auth/callback': 'GET', '/auth/logout': 'POST' };
  if (!Object.hasOwn(methods, path)) return null;
  if (request.method !== methods[path]) return new Response(null, { status: 405, headers: { allow: methods[path] } });
  validNow(now);
  try {
    if (path === '/auth/login') return await login(request, env, now);
    if (path === '/auth/callback') return await callback(request, env, now, fetcher);
    const identity = await authenticate(request, env, { now });
    requireCsrf(request, env, identity);
    await run(env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(await hash(cookie(request, SESSION_COOKIE))));
    return json(200, { status: 'signed_out' }, [setCookie(SESSION_COOKIE, '', 0)]);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    fail('AUTH_UNAVAILABLE', 503);
  }
}
