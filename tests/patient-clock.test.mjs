import test from 'node:test';
import assert from 'node:assert/strict';
import { PatientClock } from '../src/patient-clock.mjs';
import { createTestDb } from './helpers/db.mjs';
import { bangkokInstant } from '../src/scheduler.mjs';

const owner = `U${'1'.repeat(32)}`, at = time => bangkokInstant('2026-10-26', time);
function storage() {
  const data = new Map(); let alarm = null;
  return { data, async get(key) { return data.get(key); }, async put(key, value) { data.set(key, value); },
    async getAlarm() { return alarm; }, async setAlarm(time) { alarm = time; }, async deleteAlarm() { alarm = null; } };
}
const request = patientId => new Request('https://clock/wake', { method: 'POST', body: JSON.stringify({ patientId }) });
function fixture() {
  const f = createTestDb();
  f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,0)').run(owner, owner);
  f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
    VALUES('p1',?,'Synthetic','2026-10-26',0,0,'seed')`).run(owner);
  f.sql.prepare("INSERT INTO care_members VALUES('p1',?,'owner',NULL)").run(owner);
  f.sql.exec("INSERT INTO care_schedules(patient_id,current_version) VALUES('p1',1)");
  f.sql.exec(`INSERT INTO medication_schedules VALUES('s1','p1','Synthetic','','["08:00"]','[0,1,2,3,4,5,6]','2026-10-26',NULL,1,1,0)`);
  return f;
}

test('internal wake persists patient identity and crash-safe alarm before background work', async t => {
  t.mock.method(Date, 'now', () => at('07:00'));
  const store = storage(), object = new PatientClock({ storage: store }, { SCHEDULER_ENABLED: 'true' });
  assert.equal((await object.fetch(request('p1'))).status, 202);
  assert.equal(await store.get('patientId'), 'p1');
  assert.equal(await store.getAlarm(), at('07:00') + 1000);
  await store.setAlarm(at('07:00') + 500);
  await object.fetch(request('p1'));
  assert.equal(await store.getAlarm(), at('07:00') + 500);
  await store.setAlarm(at('08:00'));
  await object.fetch(new Request('https://clock/wake', { method: 'POST', body: JSON.stringify({ patientId: 'p1', onlyIfMissing: true }) }));
  assert.equal(await store.getAlarm(), at('08:00'));
  assert.equal((await object.fetch(request('p2'))).status, 409);
  assert.equal((await object.fetch(new Request('https://clock/wake'))).status, 404);
  assert.equal((await object.fetch(request('../bad'))).status, 400);
});

test('recreated Durable Object uses persisted patient and schedules next precise boundary', async t => {
  let time = at('07:00'); t.mock.method(Date, 'now', () => time);
  const f = fixture(); try {
    const store = storage(), env = { DB: f.db, SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'false' };
    await new PatientClock({ storage: store }, env).fetch(request('p1'));
    const restarted = new PatientClock({ storage: store }, env);
    await restarted.alarm();
    assert.equal(await store.getAlarm(), at('08:00'));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n, 2);
    assert.equal(await store.get('lastSuccessAt'), time);
    time = at('08:00'); await restarted.alarm();
    assert.ok((await store.getAlarm()) > time);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status='sent'").get().n, 0);
    f.sql.exec('UPDATE patients SET revoked_at=1'); await restarted.alarm();
    assert.equal(await store.getAlarm(), null);
  } finally { f.close(); }
});

test('disabled scheduling removes alarm and never touches D1; storage failure safely rearms', async t => {
  t.mock.method(Date, 'now', () => at('07:00'));
  const store = storage(); await store.setAlarm(1); await store.put('patientId', 'p1');
  const disabled = new PatientClock({ storage: store }, { SCHEDULER_ENABLED: 'false', DB: { prepare() { assert.fail('must not touch D1'); } } });
  await disabled.alarm(); assert.equal(await store.getAlarm(), null);
  assert.equal((await disabled.fetch(request('p1'))).status, 204);
  const failed = new PatientClock({ storage: store }, { SCHEDULER_ENABLED: 'true', DB: { prepare() { throw Error('private DB error'); } } });
  await assert.rejects(failed.alarm(), error => error.message === 'PATIENT_CLOCK_FAILED');
  assert.equal(await store.getAlarm(), at('07:01'));
});
