import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { projectEvents, persistEvents, MAX_EVENTS, RETENTION_MS } from '../src/ingestion.mjs';
import { handleRequest } from '../src/webhook.mjs';
const event = { webhookEventId: 'synthetic-event', type: 'message', timestamp: 1, source: { userId: 'synthetic-user' }, message: { text: 'DO NOT RETAIN', id: 'media-id' }, replyToken: 'DO NOT RETAIN' };
function database(fail = false) {
  return { rows: new Map(), calls: 0, prepare(sql) { return { bind: (...values) => ({ sql, values }) }; },
    async batch(statements) {
      this.calls++;
      if (fail) throw new Error('synthetic storage failure');
      for (const statement of statements) {
        assert.match(statement.sql, /ON CONFLICT\(event_id\) DO NOTHING/);
        if (!this.rows.has(statement.values[0])) this.rows.set(statement.values[0], statement.values);
      }
      return statements.map(() => ({ success: true }));
    } };
}
function signed(events, signature) {
  const body = JSON.stringify({ events });
  return new Request('https://example.test/webhook/line', { method: 'POST', body, headers: { 'x-line-signature': signature ?? createHmac('sha256', 'synthetic-secret').update(body).digest('base64') } });
}
const config = DB => ({ DB, LINE_CHANNEL_SECRET: 'synthetic-secret', INGESTION_ENABLED: 'true' });
test('projection retains only bounded metadata and explicit expiry', () => {
  const [row] = projectEvents([event], 1000);
  assert.deepEqual(Object.keys(row).sort(), ['eventId','expiresAt','postbackData','receivedAt','timestamp','type','userId'].sort());
  assert.equal(row.expiresAt, 1000 + RETENTION_MS);
  assert.ok(!JSON.stringify(row).includes('DO NOT RETAIN'));
});
test('postback data bounded, missing user allowed, malformed metadata rejected', () => {
  assert.equal(projectEvents([{...event, source: {}, type:'postback', postback:{data:'dose=synthetic'}}], 1)[0].userId, null);
  for (const value of [null, {...event, webhookEventId:''}, {...event, timestamp:NaN}, {...event, type:'postback',postback:{data:'x'.repeat(257)}}, {...event,source:{userId:3}}]) assert.throws(() => projectEvents([value],1));
  assert.throws(() => projectEvents(Array(MAX_EVENTS + 1).fill(event), 1));
});
test('parameterized inbox inserts deduplicate on event ID', async () => {
  const db = database(); const rows = projectEvents([event],1);
  await persistEvents(db, rows); await persistEvents(db, rows);
  assert.equal(db.rows.size,1); assert.equal(db.calls,2);
});
test('adapter stores only after verified signature and durable completion', async () => {
  const db=database();
  assert.equal((await handleRequest(signed([event], 'invalid'),config(db))).status,401);
  assert.equal(db.calls,0);
  const response=await handleRequest(signed([event]),config(db));
  assert.equal(response.status,200); assert.deepEqual(await response.json(),{status:'stored'});
  assert.equal(db.rows.size,1); assert.ok(!JSON.stringify([...db.rows]).includes('DO NOT RETAIN'));
});
test('all events validated before any batch writes', async () => {
  const db=database();
  assert.equal((await handleRequest(signed([event,{...event,webhookEventId:''}]),config(db))).status,400);
  assert.equal(db.calls,0);
});
test('failed or missing storage and disabled ingestion never acknowledge', async () => {
  for (const env of [config(database(true)),config(undefined),{...config(database()),INGESTION_ENABLED:'false'}]) assert.equal((await handleRequest(signed([event]),env)).status,503);
  await assert.rejects(persistEvents({...database(), async batch(){return [{success:false}];}},projectEvents([event],1)));
});
