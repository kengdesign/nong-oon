import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleRequest, MAX_WEBHOOK_BYTES } from '../src/webhook.mjs';
const secret = 'synthetic-test-only-secret';
const sign = body => createHmac('sha256', secret).update(body).digest('base64');
const request = (body, signature = sign(body), extraHeaders = {}) => new Request('https://example.test/webhook/line', {
  method: 'POST', headers: { ...(signature === null ? {} : { 'x-line-signature': signature }), ...extraHeaders }, body,
});
const env = { LINE_CHANNEL_SECRET: secret };
test('valid signed empty verification payload accepted', async () => {
  const r = await handleRequest(request('{"destination":"synthetic","events":[]}'), env);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'verified' });
});
test('missing or invalid signature rejected', async () => {
  for (const signature of [null, 'garbage', Buffer.alloc(32).toString('base64')]) {
    assert.equal((await handleRequest(request('{"events":[]}', signature), env)).status, 401);
  }
});
test('signature binds exact raw body including whitespace', async () => {
  const original = '{"events":[]}';
  assert.equal((await handleRequest(request('{ "events":[]}', sign(original)), env)).status, 401);
});
test('secret missing or blank fails closed', async () => {
  for (const config of [{}, { LINE_CHANNEL_SECRET: '' }, { LINE_CHANNEL_SECRET: '  ' }]) {
    assert.equal((await handleRequest(request('{"events":[]}'), config)).status, 503);
  }
});
test('actual oversized body rejected without trusting content-length', async () => {
  const body = 'x'.repeat(MAX_WEBHOOK_BYTES + 1);
  assert.equal((await handleRequest(request(body, sign(body), { 'content-length': '1' }), env)).status, 413);
});
test('declared oversized body rejected', async () => {
  assert.equal((await handleRequest(request('{}', sign('{}'), { 'content-length': String(MAX_WEBHOOK_BYTES + 1) }), env)).status, 413);
});
test('verified nonempty events never acknowledged until durable ingestion ready', async () => {
  const r = await handleRequest(request('{"events":[{"webhookEventId":"test-event","type":"message","timestamp":1}]}'), env);
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'DURABLE_INGESTION_NOT_READY');
});
test('malformed signed JSON and invalid events rejected', async () => {
  for (const body of ['{', '{}', 'null', '{"events":{}}']) assert.equal((await handleRequest(request(body), env)).status, 400);
});
test('health route does not expose credentials or claim production readiness', async () => {
  const r = await handleRequest(new Request('https://example.test/health'), env);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'staging', deliveryEnabled: false });
  const now=Date.now();
  const enabled=await handleRequest(new Request('https://example.test/health'),{...env,APP_ENV:'staging',DELIVERY_ENABLED:'true',
    SCHEDULER_ENABLED:'true',DELIVERY_START_AT:String(now-1000),DELIVERY_STOP_AT:String(now+60000)});
  assert.equal((await enabled.json()).deliveryEnabled,true);
  const expired=await handleRequest(new Request('https://example.test/health'),{...env,APP_ENV:'staging',DELIVERY_ENABLED:'true',
    SCHEDULER_ENABLED:'true',DELIVERY_START_AT:String(now-60000),DELIVERY_STOP_AT:String(now-1000)});
  assert.equal((await expired.json()).deliveryEnabled,false);
});
test('wrong paths and methods rejected', async () => {
  assert.equal((await handleRequest(new Request('https://example.test/other'), env)).status, 404);
  assert.equal((await handleRequest(new Request('https://example.test/webhook/line'), env)).status, 405);
});
