import { projectEvents, persistEvents } from './ingestion.mjs';
// Foundation adapter: ingestion only, with outbound delivery disabled.
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
export async function handleRequest(request, env = {}) {
  const path = new URL(request.url).pathname;
  if (path === '/health' && request.method === 'GET') return json(200, { status: 'foundation', deliveryEnabled: false });
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
  return json(200, { status: 'stored' });
}
export default { fetch: handleRequest };
