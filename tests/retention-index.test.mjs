import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { purgeExpiredInbox } from '../src/retention.mjs';

test('retention selects a bounded batch without sorting tied expiry rows', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const name of ['0001_webhook_inbox.sql', '0002_retention_covering_index.sql'])
      sqlite.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    const insert = sqlite.prepare('INSERT INTO webhook_inbox VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 104; i >= 0; i--)
      insert.run('expired_' + String(i).padStart(3, '0'), 'message', 0, null, null, 0, 10);
    insert.run('future', 'message', 0, null, null, 0, 30);
    const plan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT event_id FROM webhook_inbox WHERE expires_at <= ? ORDER BY expires_at, event_id LIMIT ?').all(20, 100);
    assert.ok(plan.some(row => row.detail.includes('webhook_inbox_expiry_event')));
    assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')));
    let calls = 0;
    const db = { prepare(sql) { return { bind(...args) { return { async run() {
      calls++;
      return { success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } };
    } }; } }; } };
    assert.deepEqual(await purgeExpiredInbox(db, 20), { deleted: 100 });
    assert.equal(calls, 1);
    assert.deepEqual(sqlite.prepare('SELECT event_id FROM webhook_inbox ORDER BY event_id').all().map(row => row.event_id),
      ['expired_100', 'expired_101', 'expired_102', 'expired_103', 'expired_104', 'future']);
    assert.deepEqual(await purgeExpiredInbox(db, 20), { deleted: 5 });
    assert.deepEqual(await purgeExpiredInbox(db, 20), { deleted: 0 });
    assert.equal(sqlite.prepare('SELECT event_id FROM webhook_inbox').get().event_id, 'future');
  } finally { sqlite.close(); }
});

