import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { authenticate, requireCsrf, handleAuth, AuthError, OAUTH_TTL_MS, SESSION_TTL_MS,
  MAX_AUTH_RATE_ROWS, MAX_OAUTH_STATES, LOGIN_STARTS_PER_MINUTE } from '../src/auth.mjs';

const origin = 'https://staging.nongoon.com';
const now = 1800000000000;
const actor = `U${'a'.repeat(32)}`;
const csrf = 'c'.repeat(64);
const secret = 'test-only-line-login-secret';
const sha = value => createHash('sha256').update(value).digest('hex');
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0004_auth.sql', import.meta.url), 'utf8'));
  const execute = (query, values, operation) => {
    const stmt = sql.prepare(query);
    if (operation === 'first') return stmt.get(...values) ?? null;
    if (operation === 'all') return { success: true, results: stmt.all(...values) };
    return { success: true, meta: { changes: stmt.run(...values).changes } };
  };
  const db = {
    prepare(query) { return { bind(...values) { return { query, values,
      first: async () => execute(query, values, 'first'),
      all: async () => execute(query, values, 'all'),
      run: async () => execute(query, values, 'run'),
    }; } }; },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map(({ query, values }) => execute(query, values, 'run'));
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, env: { DB: db, APP_ORIGIN: origin, LINE_LOGIN_CHANNEL_ID: '1234567890', LINE_LOGIN_CHANNEL_SECRET: secret }, close: () => sql.close() };
}
async function start(env) {
  const response = await handleAuth(new Request(`${origin}/auth/login`), env, { now });
  const url = new URL(response.headers.get('location'));
  return { response, url, cookie: response.headers.getSetCookie()[0].split(';')[0] };
}
function callback(flow, extra = {}) {
  const params = new URLSearchParams({ state: flow.url.searchParams.get('state'), code: 'test-code', ...extra });
  return new Request(`${origin}/auth/callback?${params}`, { headers: { cookie: flow.cookie } });
}
function provider(flow, override = {}, observed = []) {
  return async (url, options) => {
    observed.push({ url, options });
    const fields = new URLSearchParams(options.body);
    if (url.endsWith('/token')) {
      assert.equal(fields.get('client_secret'), secret);
      assert.equal(fields.get('grant_type'), 'authorization_code');
      assert.equal(fields.get('redirect_uri'), `${origin}/auth/callback`);
      assert.equal(createHash('sha256').update(fields.get('code_verifier')).digest('base64url'), flow.url.searchParams.get('code_challenge'));
      return Response.json({ id_token: 'test-only-id-token', access_token: 'DO_NOT_STORE_ACCESS', refresh_token: 'DO_NOT_STORE_REFRESH' });
    }
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(fields.get('id_token'), 'test-only-id-token');
    assert.equal(fields.get('nonce'), flow.url.searchParams.get('nonce'));
    return Response.json({ iss: 'https://access.line.me', sub: actor, aud: '1234567890',
      nonce: flow.url.searchParams.get('nonce'), exp: now / 1000 + 600, iat: now / 1000, ...override });
  };
}
const isCode = (code, status) => error => error instanceof AuthError && error.code === code && (!status || error.status === status);

test('login stores only hashed state/browser binding and sends fixed callback, nonce and S256 challenge', async () => {
  const f = setup(); try {
    const flow = await start(f.env);
    assert.equal(flow.response.status, 303);
    assert.equal(flow.url.origin, 'https://access.line.me');
    assert.equal(flow.url.searchParams.get('scope'), 'openid');
    assert.equal(flow.url.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
    assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(flow.response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
    assert.ok(!flow.response.headers.get('set-cookie').includes('Domain='));
    const stored = f.sql.prepare('SELECT * FROM oauth_states').get();
    assert.equal(stored.state_hash, sha(flow.url.searchParams.get('state')));
    assert.equal(stored.browser_hash, sha(flow.cookie.split('=')[1]));
    assert.equal(stored.expires_at, now + OAUTH_TTL_MS);
    assert.notEqual(stored.code_verifier, flow.url.searchParams.get('code_challenge'));
  } finally { f.close(); }
});

test('verified callback creates opaque hashed session; provider tokens never enter SQL/session', async () => {
  const f = setup(); try {
    const flow = await start(f.env), observed = [];
    const response = await handleAuth(callback(flow), f.env, { now, fetcher: provider(flow, {}, observed) });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${origin}/`);
    const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-nongoon='));
    const rawSession = sessionCookie.split(';')[0].split('=')[1];
    const row = f.sql.prepare('SELECT * FROM sessions').get();
    assert.equal(row.session_hash, sha(rawSession));
    assert.equal(row.expires_at, now + SESSION_TTL_MS);
    assert.ok(!JSON.stringify(row).includes('DO_NOT_STORE'));
    assert.ok(!JSON.stringify(row).includes('test-only-id-token'));
    assert.equal(observed.length, 2);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, 0);
    const identity = await authenticate(new Request(`${origin}/api/session`, { headers: { cookie: sessionCookie.split(';')[0] } }), f.env, { now });
    assert.equal(identity.actorId, actor);
    assert.equal(identity.csrf, row.csrf);
  } finally { f.close(); }
});

test('cookie binding, state expiry, duplicate parameters and callback replay reject before provider calls', async () => {
  for (const variant of ['cookie', 'expiry', 'duplicate', 'replay']) {
    const f = setup(); try {
      const flow = await start(f.env);
      let request = callback(flow), when = now;
      if (variant === 'cookie') request = new Request(request.url, { headers: { cookie: `__Host-nongoon-login=${'b'.repeat(64)}` } });
      if (variant === 'expiry') when += OAUTH_TTL_MS;
      if (variant === 'duplicate') request = new Request(`${request.url}&state=${flow.url.searchParams.get('state')}`, { headers: { cookie: flow.cookie } });
      if (variant === 'replay') await handleAuth(request, f.env, { now, fetcher: provider(flow) });
      await assert.rejects(handleAuth(request, f.env, { now: when, fetcher: () => assert.fail('provider must not run') }), isCode('LOGIN_STATE_REJECTED'));
    } finally { f.close(); }
  }
});

test('claims must match verified issuer, audience, nonce, LINE subject and fresh token lifetime', async () => {
  for (const claims of [{ iss: 'https://evil.test' }, { aud: '9999999999' }, { nonce: 'wrong' },
    { sub: 'attacker' }, { exp: now / 1000 }, { iat: now / 1000 + 61 }, { iat: now / 1000 - 661 },
    { exp: '1800000600' }, { iat: null }]) {
    const f = setup(); try {
      const flow = await start(f.env);
      await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher: provider(flow, claims) }), isCode('LOGIN_REJECTED'));
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    } finally { f.close(); }
  }
});

test('blocked accounts cannot obtain a session or reactivate themselves through login', async () => {
  const f = setup(); try {
    f.sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(actor, actor, now - 1, now - 100);
    const flow = await start(f.env);
    await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher: provider(flow) }), isCode('ACCOUNT_BLOCKED', 403));
    assert.equal(f.sql.prepare('SELECT blocked_at FROM accounts').get().blocked_at, now - 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  } finally { f.close(); }
});

test('sessions reject missing, duplicate, forged, expired cookies and blocked users; identity headers do not authenticate', async () => {
  const f = setup(); try {
    const raw = 'd'.repeat(64);
    f.sql.prepare('INSERT INTO accounts VALUES(?,?,NULL,?)').run(actor, actor, now - 100);
    f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(raw), actor, csrf, now - 100, now + 1);
    for (const cookie of ['', `__Host-nongoon=${'e'.repeat(64)}`, `__Host-nongoon=${raw}; __Host-nongoon=${raw}`]) {
      await assert.rejects(authenticate(new Request(`${origin}/api/session`, { headers: { cookie, 'x-actor-id': actor } }), f.env, { now }), isCode('UNAUTHENTICATED'));
    }
    const request = new Request(`${origin}/api/session`, { headers: { cookie: `__Host-nongoon=${raw}` } });
    await assert.rejects(authenticate(request, f.env, { now: now + 1 }), isCode('UNAUTHENTICATED'));
    f.sql.prepare('UPDATE accounts SET blocked_at=?').run(now);
    await assert.rejects(authenticate(request, f.env, { now }), isCode('UNAUTHENTICATED'));
  } finally { f.close(); }
});

test('logout requires exact origin and session CSRF then revokes only that session', async () => {
  const f = setup(); try {
    const raw = 'd'.repeat(64), other = 'e'.repeat(64);
    f.sql.prepare('INSERT INTO accounts VALUES(?,?,NULL,?)').run(actor, actor, now - 100);
    for (const value of [raw, other]) f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(value), actor, csrf, now - 100, now + SESSION_TTL_MS);
    for (const headers of [{}, { origin, 'x-csrf-token': 'wrong' }, { origin: 'https://evil.test', 'x-csrf-token': csrf },
      { origin, 'x-csrf-token': csrf, 'sec-fetch-site': 'cross-site' }]) {
      await assert.rejects(handleAuth(new Request(`${origin}/auth/logout`, { method: 'POST', headers: { cookie: `__Host-nongoon=${raw}`, ...headers } }), f.env, { now }), isCode('CSRF_REJECTED', 403));
    }
    const response = await handleAuth(new Request(`${origin}/auth/logout`, { method: 'POST', headers: { cookie: `__Host-nongoon=${raw}`, origin, 'x-csrf-token': csrf } }), f.env, { now });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal(f.sql.prepare('SELECT session_hash FROM sessions').get().session_hash, sha(other));
  } finally { f.close(); }
});

test('login fails closed for bad configuration/origin/method and provider errors do not leak bodies', async () => {
  const f = setup(); try {
    for (const env of [{ ...f.env, APP_ORIGIN: 'http://staging.nongoon.com' },
      { ...f.env, APP_ORIGIN: `${origin}/` }, { ...f.env, LINE_LOGIN_CHANNEL_SECRET: '' }])
      await assert.rejects(handleAuth(new Request(`${origin}/auth/login`), env, { now }), isCode('AUTH_NOT_CONFIGURED', 503));
    await assert.rejects(handleAuth(new Request('https://evil.test/auth/login'), f.env, { now }), isCode('INVALID_ORIGIN', 400));
    assert.equal((await handleAuth(new Request(`${origin}/auth/logout`), f.env, { now })).status, 405);
    assert.equal(await handleAuth(new Request(`${origin}/unknown`), f.env, { now }), null);
    const flow = await start(f.env);
    await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher: async () => new Response(`private ${secret}`, { status: 500 }) }), error =>
      isCode('LOGIN_PROVIDER_UNAVAILABLE', 502)(error) && !error.message.includes(secret));
  } finally { f.close(); }
});

test('oversized provider response and network failure reject without saving a session', async () => {
  for (const fetcher of [async () => new Response('x'.repeat(65537)), async () => { throw Error(`private ${secret}`); }]) {
    const f = setup(); try {
      const flow = await start(f.env);
      await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher }), isCode('LOGIN_PROVIDER_UNAVAILABLE', 502));
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    } finally { f.close(); }
  }
});

test('cancellation consumes the browser-bound state and returns a non-sensitive fixed destination', async () => {
  const f = setup(); try {
    const flow = await start(f.env);
    const response = await handleAuth(callback(flow, { error: 'access_denied', error_description: 'private-data' }), f.env, { now, fetcher: () => assert.fail('no provider call') });
    assert.equal(response.headers.get('location'), `${origin}/?login=cancelled`);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, 0);
    await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher: () => assert.fail('replay') }), isCode('LOGIN_STATE_REJECTED'));
  } finally { f.close(); }
});

test('concurrent callbacks exchange once and session rotation revokes the previous browser session', async () => {
  const f = setup(); try {
    const old = 'd'.repeat(64);
    f.sql.prepare('INSERT INTO accounts VALUES(?,?,NULL,?)').run(actor, actor, now - 100);
    f.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(old), actor, csrf, now - 100, now + SESSION_TTL_MS);
    const flow = await start(f.env), observed = [];
    const request = new Request(callback(flow).url, { headers: { cookie: `${flow.cookie}; __Host-nongoon=${old}` } });
    const results = await Promise.allSettled([
      handleAuth(request, f.env, { now, fetcher: provider(flow, {}, observed) }),
      handleAuth(request, f.env, { now, fetcher: provider(flow, {}, observed) }),
    ]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(observed.length, 2);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions WHERE session_hash=?').get(sha(old)).n, 0);
  } finally { f.close(); }
});

test('database failures are sanitized and account/session batch failure rolls back account creation', async () => {
  const f = setup(); try {
    const flow = await start(f.env);
    f.sql.exec(`CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'private schema detail'); END;`);
    await assert.rejects(handleAuth(callback(flow), f.env, { now, fetcher: provider(flow) }), isCode('AUTH_UNAVAILABLE', 503));
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    const broken = { ...f.env, DB: { prepare() { throw Error(`private ${secret}`); } } };
    await assert.rejects(authenticate(new Request(`${origin}/api/session`, { headers: { cookie: `__Host-nongoon=${'d'.repeat(64)}` } }), broken, { now }), isCode('AUTH_UNAVAILABLE', 503));
    assert.throws(() => requireCsrf(new Request(`${origin}/api/anything`, { headers: { origin, 'x-csrf-token': csrf } }), f.env, { csrf: null }), isCode('CSRF_REJECTED', 403));
  } finally { f.close(); }
});

test('login throttles each ingress IP to ten starts per minute and persists no raw IP', async () => {
  const f = setup(); try {
    const request = () => new Request(`${origin}/auth/login`, { headers: { 'cf-connecting-ip': '192.0.2.12' } });
    for (let n = 0; n < LOGIN_STARTS_PER_MINUTE; n++) assert.equal((await handleAuth(request(), f.env, { now })).status, 303);
    await assert.rejects(handleAuth(request(), f.env, { now }), isCode('LOGIN_RATE_LIMITED', 429));
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, LOGIN_STARTS_PER_MINUTE);
    assert.equal(f.sql.prepare('SELECT attempts FROM auth_rate_limits').get().attempts, LOGIN_STARTS_PER_MINUTE);
    assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM auth_rate_limits').all()).includes('192.0.2.12'));
    const nextMinute = now + 60000;
    assert.equal((await handleAuth(request(), f.env, { now: nextMinute })).status, 303);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM auth_rate_limits').get().n, 1);
    assert.equal((await handleAuth(new Request(`${origin}/auth/login`, { headers: { 'cf-connecting-ip': '192.0.2.13' } }), f.env, { now: nextMinute })).status, 303);
  } finally { f.close(); }
});

test('login salt rotates daily and missing/invalid IPs share a fail-closed bucket', async () => {
  const f = setup(); try {
    await start(f.env);
    const salt = f.sql.prepare('SELECT salt,expires_at FROM auth_rate_salt').get();
    for (let n = 1; n < LOGIN_STARTS_PER_MINUTE; n++) await start(f.env);
    await assert.rejects(handleAuth(new Request(`${origin}/auth/login`, { headers: { 'cf-connecting-ip': 'attacker-controlled-invalid-value' } }), f.env, { now }), isCode('LOGIN_RATE_LIMITED', 429));
    assert.equal((await handleAuth(new Request(`${origin}/auth/login`), f.env, { now: salt.expires_at })).status, 303);
    assert.notEqual(f.sql.prepare('SELECT salt FROM auth_rate_salt').get().salt, salt.salt);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM auth_rate_salt').get().n, 1);
  } finally { f.close(); }
});

test('login caps pending OAuth states and rate rows and expires data in bounded batches', async () => {
  for (const full of ['states', 'rates']) {
    const f = setup(); try {
      if (full === 'states') {
        const insert = f.sql.prepare('INSERT INTO oauth_states VALUES(?,?,?,?,?)');
        for (let n = 0; n < MAX_OAUTH_STATES; n++) insert.run(`s${n}`, 'browser', 'nonce', 'verifier', now + OAUTH_TTL_MS);
        await assert.rejects(start(f.env), isCode('LOGIN_CAPACITY_REACHED', 503));
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, MAX_OAUTH_STATES);
        f.sql.exec(`UPDATE oauth_states SET expires_at=${now}`);
        await start(f.env);
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, MAX_OAUTH_STATES - 99);
      } else {
        const insert = f.sql.prepare('INSERT INTO auth_rate_limits VALUES(?,?,?)');
        for (let n = 0; n < MAX_AUTH_RATE_ROWS; n++) insert.run(`r${n}`, 1, now + 60000);
        await assert.rejects(start(f.env), isCode('LOGIN_RATE_LIMITED', 429));
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM auth_rate_limits').get().n, MAX_AUTH_RATE_ROWS);
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, 0);
        f.sql.exec(`UPDATE auth_rate_limits SET expires_at=${now}`);
        await start(f.env);
        assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM auth_rate_limits').get().n, MAX_AUTH_RATE_ROWS - 99);
      }
    } finally { f.close(); }
  }
});
