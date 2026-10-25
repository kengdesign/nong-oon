import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { handleRequest } from '../src/webhook.mjs';
import { purgeExpiredInbox } from '../src/retention.mjs';

test('signed webhook persists once in real SQL and expires without retaining message content', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../migrations/0001_webhook_inbox.sql', import.meta.url), 'utf8'));
    const db = {
      prepare(query) {
        return { bind(...values) {
          return { query, values, async run() {
            return { success: true, meta: { changes: sqlite.prepare(query).run(...values).changes } };
          } };
        } };
      },
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          const results = statements.map(({ query, values }) => ({
            success: true, meta: { changes: sqlite.prepare(query).run(...values).changes },
          }));
          sqlite.exec('COMMIT');
          return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    const secret = 'test-only-synthetic-secret';
    const body = JSON.stringify({ events: [{
      webhookEventId: 'qa_sql_e2e', type: 'message', timestamp: 1,
      source: { userId: 'qa_synthetic_user' },
      message: { text: 'DO_NOT_RETAIN_MESSAGE', id: 'DO_NOT_RETAIN_MEDIA' },
      replyToken: 'DO_NOT_RETAIN_TOKEN',
    }] });
    const signed = (signature = createHmac('sha256', secret).update(body).digest('base64')) =>
      new Request('https://example.test/webhook/line', {
        method: 'POST', headers: { 'x-line-signature': signature }, body,
      });
    const env = { DB: db, LINE_CHANNEL_SECRET: secret, INGESTION_ENABLED: 'true' };
    const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM webhook_inbox').get().n;
    assert.equal((await handleRequest(signed('invalid'), env)).status, 401);
    assert.equal(count(), 0);
    assert.equal((await handleRequest(signed(), { ...env, INGESTION_ENABLED: 'false' })).status, 503);
    assert.equal(count(), 0);
    for (let n = 0; n < 2; n++) {
      const response = await handleRequest(signed(), env);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'stored' });
    }
    assert.equal(count(), 1);
    const row = sqlite.prepare('SELECT * FROM webhook_inbox').get();
    assert.equal(row.event_id, 'qa_sql_e2e');
    assert.equal(row.user_id, 'qa_synthetic_user');
    assert.equal(row.expires_at - row.received_at, 7 * 24 * 60 * 60 * 1000);
    assert.ok(!JSON.stringify(row).includes('DO_NOT_RETAIN'));
    assert.deepEqual(await purgeExpiredInbox(db, row.expires_at - 1), { deleted: 0 });
    assert.equal(count(), 1);
    assert.deepEqual(await purgeExpiredInbox(db, row.expires_at), { deleted: 1 });
    assert.equal(count(), 0);
    assert.deepEqual(await purgeExpiredInbox(db, row.expires_at), { deleted: 0 });
  } finally { sqlite.close(); }
});
