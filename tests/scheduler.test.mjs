import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.mjs';
import { bangkokDay, bangkokInstant, planOccurrences, materializePatient, nextWake, runPatient, recoverSchedules } from '../src/scheduler.mjs';

const owner = `U${'1'.repeat(32)}`, caregiver = `U${'2'.repeat(32)}`;
const at = time => bangkokInstant('2026-10-26', time);
function fixture() {
  const f = createTestDb();
  for (const actor of [owner, caregiver]) f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(actor, actor, at('00:00'));
  f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
    VALUES('p1',?,'Synthetic','2026-10-26',?,?,'seed')`).run(owner, at('00:00'), at('00:00'));
  f.sql.prepare("INSERT INTO care_members VALUES('p1',?,'owner',NULL),('p1',?,'caregiver',NULL)").run(owner, caregiver);
  f.sql.exec("INSERT INTO care_schedules(patient_id,current_version) VALUES('p1',1)");
  f.sql.exec(`INSERT INTO medication_schedules VALUES('s1','p1','Synthetic medication','Label only','["08:00","18:00"]','[0,1,2,3,4,5,6]','2026-10-26',NULL,1,1,0)`);
  return f;
}
const readSchedule = f => f.sql.prepare('SELECT * FROM medication_schedules').all();

test('Bangkok boundaries, leap/calendar rejection and stable occurrence IDs across revisions', async () => {
  assert.equal(bangkokDay(Date.parse('2026-10-25T17:00:00Z')), '2026-10-26');
  assert.equal(at('08:00'), Date.parse('2026-10-26T01:00:00Z'));
  assert.throws(() => bangkokInstant('2026-02-30', '12:00'), /INVALID_SCHEDULE/);
  const f = fixture(); try {
    const planned = await planOccurrences(readSchedule(f), at('07:00'));
    assert.equal(planned.length, 4);
    assert.equal(planned[0].dueAt, at('08:00'));
    assert.equal(planned[0].expiresAt - planned[0].dueAt, 7200000);
    assert.deepEqual(await planOccurrences(readSchedule(f), at('07:00')), planned);
    const changed = await planOccurrences(readSchedule(f).map(s => ({ ...s, version: 2 })), at('07:00'));
    assert.equal(changed[0].doseId, planned[0].doseId);
    assert.notEqual(changed[0].version, planned[0].version);
    assert.ok(planned.every(o => /^[0-9a-f]{64}$/.test(o.doseId)));
  } finally { f.close(); }
});

test('weekday/date range and late-job policy are explicit, bounded and do not backfill', async () => {
  const f = fixture(); try {
    assert.equal((await planOccurrences(readSchedule(f), at('08:15'))).length, 4);
    assert.equal((await planOccurrences(readSchedule(f), at('08:16'))).length, 3);
    const schedule = readSchedule(f)[0];
    assert.equal((await planOccurrences([{ ...schedule, end_date: '2026-10-26' }], at('07:00'))).length, 2);
    assert.equal((await planOccurrences([{ ...schedule, weekdays_json: '[2]' }], at('07:00'))).length, 2);
    assert.equal((await planOccurrences([{ ...schedule, active: 0 }], at('07:00'))).length, 0);
    await assert.rejects(planOccurrences([{ ...schedule, times_json: '["99:99"]' }], at('07:00')), /INVALID_STORED/);
    await assert.rejects(planOccurrences(Array(21).fill(schedule), at('07:00')), /INVALID_SCHEDULE_INPUT/);
  } finally { f.close(); }
});

test('real SQL atomically creates deterministic doses and one owner/caregiver intent each', async () => {
  const f = fixture(); try {
    assert.deepEqual(await materializePatient(f.db, 'p1', at('07:00')), { dosesChanged: 4, notificationsCreated: 8 });
    assert.deepEqual(await materializePatient(f.db, 'p1', at('07:00')), { dosesChanged: 0, notificationsCreated: 0 });
    const jobs = f.sql.prepare('SELECT * FROM notification_outbox ORDER BY available_at').all();
    assert.equal(jobs[0].available_at, at('08:00'));
    assert.equal(jobs[1].available_at, at('08:30'));
    assert.ok(jobs.every(job => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(job.id)));
    assert.ok(!JSON.stringify(jobs).includes('Synthetic'));
    f.sql.exec('UPDATE care_schedules SET current_version=2; UPDATE medication_schedules SET version=2');
    await materializePatient(f.db, 'p1', at('07:00'));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n, 4);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records WHERE schedule_version=2').get().n, 4);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE schedule_version=2').get().n, 8);
  } finally { f.close(); }
});

test('revision cannot duplicate an already-due, sent or reported occurrence', async () => {
  const f = fixture(); try {
    await materializePatient(f.db, 'p1', at('07:00'));
    const first = f.sql.prepare('SELECT * FROM dose_records ORDER BY due_at LIMIT 1').get();
    f.sql.prepare("UPDATE notification_outbox SET status='sent',sent_at=? WHERE dose_id=? AND kind='reminder'").run(at('08:00'), first.dose_id);
    f.sql.exec('UPDATE care_schedules SET current_version=2; UPDATE medication_schedules SET version=2');
    await materializePatient(f.db, 'p1', at('08:05'));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records WHERE due_at=?').get(at('08:00')).n, 1);
    assert.equal(f.sql.prepare('SELECT schedule_version FROM dose_records WHERE dose_id=?').get(first.dose_id).schedule_version, 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE dose_id=? AND kind=\'reminder\'').get(first.dose_id).n, 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records WHERE schedule_version=2').get().n, 3);
  } finally { f.close(); }
});

test('outbox insertion failure rolls all new dose writes back', async () => {
  const f = fixture(); try {
    f.sql.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'private'); END;`);
    await assert.rejects(materializePatient(f.db, 'p1', at('07:00')));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n, 0);
  } finally { f.close(); }
});

test('consent/account changes between forecast and write cannot insert doses', async () => {
  for (const mutation of ["UPDATE patients SET revoked_at=1", "UPDATE accounts SET blocked_at=1", "UPDATE care_schedules SET current_version=2"]) {
    const f = fixture(); try {
      const realBatch = f.db.batch;
      f.db.batch = async queries => { f.sql.exec(mutation); return realBatch(queries); };
      await materializePatient(f.db, 'p1', at('07:00'));
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n, 0);
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n, 0);
    } finally { f.close(); }
  }
});

test('scheduler and delivery switches are independent and fail closed', async () => {
  const f = fixture(); try {
    assert.deepEqual(await runPatient(f.db, 'p1', at('08:00')), { skipped: true });
    let sends = 0;
    const result = await runPatient(f.db, 'p1', at('08:00'), { env: { SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'false' }, fetcher: () => { sends++; throw Error(); } });
    assert.equal(sends, 0); assert.equal(result.deliverySkipped, true);
    assert.equal(await nextWake(f.db, 'p1', at('07:00')), at('08:00'));
    f.sql.exec('UPDATE medication_schedules SET active=0');
    assert.equal(await nextWake(f.db, 'p1', at('07:00')), null);
  } finally { f.close(); }
});

test('recovery pages use a persisted cyclic cursor and do not starve later patients', async () => {
  const f = fixture(); try {
    for (let n = 0; n < 105; n++) {
      const actor = `synthetic_${n}`, patient = `z${String(n).padStart(3, '0')}`;
      f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,0)').run(actor, actor);
      f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id) VALUES(?,?,'Synthetic','2026-10-26',0,0,'seed')`).run(patient, actor);
      f.sql.prepare(`INSERT INTO medication_schedules VALUES(?,?,'Synthetic','','["08:00"]','[1]','2026-10-26',NULL,1,1,0)`).run(`schedule_${n}`, patient);
    }
    const awakened = [];
    const env = { DB: f.db, SCHEDULER_ENABLED: 'true', PATIENT_CLOCK: {
      idFromName: x => x, get: x => ({ fetch: async (_url, options) => { assert.equal(JSON.parse(options.body).onlyIfMissing, true); awakened.push(x); return new Response(null, { status: 202 }); } }),
    } };
    assert.deepEqual(await recoverSchedules(env, at('07:00')), { checked: 100, failed: 0 });
    assert.deepEqual(await recoverSchedules(env, at('07:05')), { checked: 6, failed: 0 });
    assert.equal(new Set(awakened).size, 106);
    assert.equal(f.sql.prepare('SELECT patient_cursor FROM scheduler_control').get().patient_cursor, '');
  } finally { f.close(); }
});

test('next wake performs no hashing/writes, handles distant start weekdays, and stops after end date', async t => {
  const f = fixture(); try {
    t.mock.method(crypto.subtle, 'digest', () => { assert.fail('forecast must not hash dose IDs'); });
    const before = f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n;
    f.sql.exec(`UPDATE medication_schedules SET times_json='["08:00"]',weekdays_json='[1]',start_date='2027-01-04'`);
    // Monday Jan4: replenish tomorrow's rows on Sunday Jan3 rather than polling
    // every midnight for the intervening months.
    assert.equal(await nextWake(f.db, 'p1', at('07:00')), bangkokInstant('2027-01-03', '00:00'));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dose_records').get().n, before);
    f.sql.exec(`UPDATE medication_schedules SET start_date='2026-10-26',end_date='2026-10-26'`);
    assert.equal(await nextWake(f.db, 'p1', at('08:01')), null);
    f.sql.exec(`UPDATE medication_schedules SET end_date='2026-10-25'`);
    // Invalid stored interval must fail closed rather than silently reschedule.
    await assert.rejects(nextWake(f.db, 'p1', at('08:01')), /INVALID_STORED_SCHEDULE/);
  } finally { f.close(); }
});
