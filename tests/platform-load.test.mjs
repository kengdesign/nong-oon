import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from './helpers/db.mjs';
import loadWorker, { LoadPatientClock } from '../platform-load/worker.mjs';

test('isolated platform drill runs three ten-profile recoveries and real alarm logic without network', async t => {
  const f = createTestDb();
  const now = Date.now();
  t.mock.method(globalThis, 'fetch', () => { assert.fail('NETWORK_FORBIDDEN'); });
  t.mock.method(console, 'log', () => {});
  try {
    f.sql.exec(readFileSync(new URL('../platform-load/seed.sql', import.meta.url), 'utf8'));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM patients').get().n, 10);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM medication_schedules').get().n, 200);
    const clocks = new Map();
    const env = { APP_ENV: 'isolated-load-review', DB: f.db,
      LINE_CHANNEL_ACCESS_TOKEN: 'must-never-be-used', DELIVERY_ENABLED: 'true',
      PATIENT_CLOCK: { idFromName: id => id, get(id) {
        if (!clocks.has(id)) {
          const data = new Map(); let alarm = null;
          const storage = { async get(k) { return data.get(k); }, async put(k,v) { data.set(k,v); },
            async getAlarm() { return alarm; }, async setAlarm(v) { alarm=v; }, async deleteAlarm() { alarm=null; } };
          clocks.set(id, { object: new LoadPatientClock({ storage }, env), storage });
        }
        return { fetch: (url, init) => clocks.get(id).object.fetch(new Request(url, init)) };
      } },
    };
    for (let cycle=1; cycle<=3; cycle++) {
      await loadWorker.scheduled({},env);
      for (const { object, storage } of clocks.values()) { await object.alarm(); assert.equal(await storage.getAlarm(),null); }
    }
    await loadWorker.scheduled({},env);
    assert.equal(f.sql.prepare('SELECT runs FROM platform_load_control').get().runs,3);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM platform_load_results').get().n,30);
    assert.equal(f.sql.prepare('SELECT SUM(attempts) n FROM notification_outbox').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n,3200);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,6400);
    assert.equal((await loadWorker.fetch()).status,404);
    assert.throws(() => new LoadPatientClock({}, { APP_ENV:'staging' }), /LOAD_ENV_REQUIRED/);
    f.sql.exec(`UPDATE platform_load_control SET expires_at=${now-1}`);
    for (const { object } of clocks.values()) await object.alarm();
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM platform_load_results').get().n,30);
  } finally { f.close(); }
});
