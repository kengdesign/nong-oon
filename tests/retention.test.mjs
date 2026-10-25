import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { purgeExpiredInbox, MAX_PURGE_ROWS } from '../src/retention.mjs';

test('purge uses real SQL to remove expired rows only, bounded per call', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(await readFile(new URL('../migrations/0001_webhook_inbox.sql', import.meta.url), 'utf8'));
    const insert = sqlite.prepare('INSERT INTO webhook_inbox VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [id, expiry] of [['old', 10], ['boundary', 20], ['future', 30]])
      insert.run(id, 'message', 0, null, null, 0, expiry);
    let calls = 0;
    const db = { prepare(sql) { return { bind(...args) { return { async run() {
      calls++;
      return { success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } };
    } }; } }; } };
    assert.deepEqual(await purgeExpiredInbox(db, 20, 1), { deleted: 1 });
    assert.equal(calls, 1);
    assert.deepEqual(sqlite.prepare('SELECT event_id FROM webhook_inbox ORDER BY event_id').all().map(r => r.event_id), ['boundary', 'future']);
    assert.deepEqual(await purgeExpiredInbox(db, 20), { deleted: 1 });
    assert.deepEqual(await purgeExpiredInbox(db, 20), { deleted: 0 });
    assert.equal(sqlite.prepare('SELECT event_id FROM webhook_inbox').get().event_id, 'future');
  } finally { sqlite.close(); }
});

test('invalid maintenance input never touches storage', async () => {
  const db = { prepare() { assert.fail('must not access storage'); } };
  for (const [now, limit] of [[-1, 1], [NaN, 1], [1, 0], [1, 1.5], [1, MAX_PURGE_ROWS + 1]])
    await assert.rejects(purgeExpiredInbox(db, now, limit), /INVALID_PURGE_INPUT/);
});

test('purge fails closed without retrying failed or malformed storage responses', async () => {
  await assert.rejects(purgeExpiredInbox(undefined, 20), /DB_NOT_READY/);
  for (const response of [{ success: false }, { success: true }, { success: true, meta: { changes: 101 } }]) {
    let calls = 0;
    const db = { prepare() { return { bind() { return { async run() { calls++; return response; } }; } }; } };
    await assert.rejects(purgeExpiredInbox(db, 20), /PURGE_FAILED/);
    assert.equal(calls, 1);
  }
});
