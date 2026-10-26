import { projectEvents, persistEvents } from './ingestion.mjs';
import { handleScheduled } from './maintenance.mjs';
import { handleAuth, authenticate, requireCsrf, AuthError } from './auth.mjs';
import { handleCareApi, CONSENT_VERSION } from './care-api.mjs';
import { armPatient } from './scheduler.mjs';
import { processLineEvents } from './line-events.mjs';
import { secure, boundedRequest } from './http.mjs';
import { handleAdminApi } from './admin-api.mjs';
export { PatientClock } from './patient-clock.mjs';
export const MAX_WEBHOOK_BYTES = 64 * 1024;
const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const bad = (code) => json(400, { error: code });
// Staging-only fixture lane. Never accepts identities, text, postbacks or tokens.
function syntheticFixture(payload, request, env) {
  if (env.APP_ENV !== 'staging' || env.DELIVERY_ENABLED !== 'false'
    || env.SYNTHETIC_INGESTION_ENABLED !== 'true'
    || new URL(request.url).hostname !== 'staging.nongoon.com') return false;
  if (Object.keys(payload).length !== 1 || payload.events.length !== 1) return false;
  const event = payload.events[0];
  return event && Object.keys(event).sort().join(',') === 'timestamp,type,webhookEventId'
    && event.type === 'follow'
    && /^qa_d1_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(event.webhookEventId)
    && Number.isSafeInteger(event.timestamp) && event.timestamp >= 0;
}
async function readBounded(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_WEBHOOK_BYTES)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function verified(bytes, signature, secret) {
  // SHA-256 digest is 32 bytes, encoded as 44 canonical base64 characters.
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  let decoded;
  try { decoded = Uint8Array.from(atob(signature), c => c.charCodeAt(0)); } catch { return false; }
  if (decoded.byteLength !== 32) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, decoded, bytes);
}
async function route(request, env = {}, context = {}) {
  const path = new URL(request.url).pathname;
  if (path === '/health' && request.method === 'GET') return json(200, { status: 'staging', deliveryEnabled: env.DELIVERY_ENABLED === 'true' });
  if (path === '/api/session' && request.method === 'GET') {
    const features = { sharingEnabled: env.SELF_CARE_ONLY !== 'true', careEnabled: env.CARE_API_ENABLED === 'true', schedulerEnabled: env.SCHEDULER_ENABLED === 'true',
      deliveryEnabled: env.DELIVERY_ENABLED === 'true',
      loginConfigured: /^\d{5,20}$/.test(env.LINE_LOGIN_CHANNEL_ID ?? '') && Boolean(env.LINE_LOGIN_CHANNEL_SECRET?.trim()) };
    let identity = null;
    try { identity = await authenticate(request, env); }
    catch (error) { if (!(error instanceof AuthError) || error.status !== 401) throw error; }
    return json(200, { authenticated: Boolean(identity), ...(identity ?? {}), features, consentVersion: CONSENT_VERSION });
  }
  if (path.startsWith('/auth/')) {
    if (env.CARE_API_ENABLED !== 'true') return json(503, { error: 'CARE_API_DISABLED' });
    return (await handleAuth(request, env)) ?? json(404, { error: 'NOT_FOUND' });
  }
  if (path.startsWith('/api/')) {
    if (env.CARE_API_ENABLED !== 'true') return json(503, { error: 'CARE_API_DISABLED' });
    const identity = await authenticate(request, env);
    const reading = ['GET','HEAD'].includes(request.method);
    const bucket = `${identity.actorId}:${Math.floor(Date.now()/60000)}:${reading?'r':'w'}`;
    const rate = await env.DB.prepare(`INSERT INTO api_rate_limits(bucket,used,expires_at) VALUES(?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET used=used+1 WHERE used<? RETURNING used`)
      .bind(bucket,Date.now()+120000,reading?120:30).all();
    if (rate?.success !== true) return json(503,{error:'SERVICE_UNAVAILABLE'});
    if (!rate.results?.length) { const r=json(429,{error:'RATE_LIMITED'});r.headers.set('retry-after','60');return r; }
    if (!['GET', 'HEAD'].includes(request.method)) {
      requireCsrf(request, env, identity);
      if (request.method !== 'DELETE' && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
        return json(415, { error: 'JSON_REQUIRED' });
      request = await boundedRequest(request);
      if (!request) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
    }
    const handler = path.startsWith('/api/admin/') ? handleAdminApi : handleCareApi;
    const response = await handler(request, env, { actorId: identity.actorId, now: Date.now() });
    const patientId = response.headers.get('x-nongoon-wake-patient');
    if (response.ok && patientId) {
      // SQL intent is already committed. Recovery Cron repairs a failed wake;
      // do not tell the client the accepted write failed and induce duplicates.
      const wake = armPatient(env, patientId).catch(() => console.warn(JSON.stringify({ task: 'clock_arm', outcome: 'failed' })));
      if (context.waitUntil) context.waitUntil(wake); else await wake;
    }
    return response;
  }
  if (path !== '/webhook/line') return json(404, { error: 'NOT_FOUND' });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (typeof env.LINE_CHANNEL_SECRET !== 'string' || !env.LINE_CHANNEL_SECRET.trim()) return json(503, { error: 'NOT_CONFIGURED' });
  let bytes;
  try { bytes = await readBounded(request); } catch { return bad('INVALID_BODY'); }
  if (bytes === null) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  if (!(await verified(bytes, request.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) return json(401, { error: 'INVALID_SIGNATURE' });
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return bad('INVALID_JSON'); }
  if (!payload || !Array.isArray(payload.events)) return bad('INVALID_EVENTS');
  if (payload.events.length === 0) return json(200, { status: 'verified' });
  let rows;
  try { rows = projectEvents(payload.events, Date.now()); } catch { return bad('INVALID_EVENTS'); }
  // Explicit opt-in prevents accidental collection before retention/privacy setup.
  if (env.INGESTION_ENABLED !== 'true' && !syntheticFixture(payload, request, env)) return json(503, { error: 'DURABLE_INGESTION_NOT_READY' });
  try { await persistEvents(env.DB, rows); } catch { return json(503, { error: 'DURABLE_INGESTION_UNAVAILABLE' }); }
  if (env.CARE_API_ENABLED === 'true') {
    try { await processLineEvents(env.DB, Date.now()); }
    catch { return json(503, { error: 'INBOX_PROCESSING_UNAVAILABLE' }); }
  }
  return json(200, { status: 'stored' });
}
export async function handleRequest(request, env = {}, context = {}) {
  try { return secure(await route(request, env, context)); }
  catch (error) {
    const known = error instanceof AuthError;
    const response = json(known ? error.status : 503, { error: known ? error.code : 'SERVICE_UNAVAILABLE' });
    if (response.status === 429) response.headers.set('retry-after', '60');
    return secure(response);
  }
}
export default { fetch: handleRequest, scheduled: handleScheduled };
