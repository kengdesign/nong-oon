import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../src/webhook.mjs';

const secret = 'synthetic-test-only';
const fixture = { webhookEventId: 'qa_d1_01234567-89ab-4cde-8abc-0123456789ab', type: 'follow', timestamp: 1 };
const config = { APP_ENV: 'staging', DELIVERY_ENABLED: 'false', INGESTION_ENABLED: 'false', SYNTHETIC_INGESTION_ENABLED: 'true', LINE_CHANNEL_SECRET: secret };
function signed(payload, host = 'staging.nongoon.com', valid = true) {
  const body = JSON.stringify(payload);
  return new Request(`https://${host}/webhook/line`, { method: 'POST', body,
    headers: { 'x-line-signature': valid ? createHmac('sha256', secret).update(body).digest('base64') : 'invalid' } });
}
test('synthetic lane writes once to real SQL without identities and fails closed on storage failure', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../migrations/0001_webhook_inbox.sql', import.meta.url), 'utf8'));
    const db = { prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          const results = statements.map(({sql, values}) => ({success: true, meta: sqlite.prepare(sql).run(...values)}));
          sqlite.exec('COMMIT'); return results;
        } catch(error) { sqlite.exec('ROLLBACK'); throw error; }
      } };
    const payload = {events: [fixture]};
    for (let i=0;i<2;i++) assert.equal((await handleRequest(signed(payload), {...config,DB:db})).status,200);
    const rows = sqlite.prepare('SELECT * FROM webhook_inbox').all();
    assert.equal(rows.length,1);
    assert.equal(rows[0].user_id,null);
    assert.equal(rows[0].postback_data,null);
    assert.equal(rows[0].expires_at-rows[0].received_at,7*24*60*60*1000);
    assert.equal((await handleRequest(signed(payload),config)).status,503);
    assert.equal((await handleRequest(signed(payload,'staging.nongoon.com',false),{...config,DB:db})).status,401);
  } finally { sqlite.close(); }
});
test('synthetic lane never opens for other hosts, environments or disabled guards', async () => {
  const DB = { prepare(){ throw Error('unexpected write'); } };
  for (const overrides of [{APP_ENV:'production'},{DELIVERY_ENABLED:'true'},{DELIVERY_ENABLED:undefined},{SYNTHETIC_INGESTION_ENABLED:'false'},{SYNTHETIC_INGESTION_ENABLED:undefined}]) {
    const response = await handleRequest(signed({events:[fixture]}),{...config,DB,...overrides});
    assert.deepEqual(await response.json(),{error:'DURABLE_INGESTION_NOT_READY'});
  }
  const response = await handleRequest(signed({events:[fixture]},'example.test'),{...config,DB});
  assert.deepEqual(await response.json(),{error:'DURABLE_INGESTION_NOT_READY'});
});
test('synthetic lane rejects any extra data and real LINE event shapes before database access', async () => {
  let calls=0;
  const DB={prepare(){calls++;throw Error('unexpected write');}};
  const bad = [
    {events:[{...fixture,source:{userId:'U_real'}}]},
    {events:[{...fixture,message:{text:'private'}}]},
    {events:[{...fixture,replyToken:'private'}]},
    {events:[{...fixture,postback:{data:'private'}}]},
    {events:[{...fixture,type:'message'}]},
    {events:[{...fixture,webhookEventId:'real_line_event'}]},
    {events:[fixture,fixture]},
    {events:[fixture],destination:'private'},
  ];
  for (const payload of bad) {
    const response=await handleRequest(signed(payload),{...config,DB});
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'DURABLE_INGESTION_NOT_READY'});
  }
  assert.equal(calls,0);
});
