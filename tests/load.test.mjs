import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createTestDb } from './helpers/db.mjs';
import { materializePatient, recoverSchedules, bangkokInstant } from '../src/scheduler.mjs';
import { deliverPatientOutbox } from '../src/delivery.mjs';

const at = time => bangkokInstant('2026-10-26', time);
const actorId = value => `U${value.toString(16).padStart(32, '0')}`;

test('maximum ten-profile synthetic pilot materializes idempotently and enforces 100/day plus 20/recipient mock-only budgets', async t => {
  const f = createTestDb();
  const started = performance.now(), cpuStarted = process.cpuUsage();
  let unexpectedNetwork = 0;
  t.mock.method(globalThis, 'fetch', async () => { unexpectedNetwork++; throw Error('REAL_NETWORK_FORBIDDEN_IN_LOAD_TEST'); });
  try {
    const patients = [], owners = [];
    const times = Array.from({ length: 8 }, (_, minute) => `08:${String(minute).padStart(2, '0')}`);
    for (let index = 0; index < 10; index++) {
      const patient = `pilot_${String(index).padStart(2, '0')}`;
      const owner = actorId(index + 1), caregiver = actorId(index + 101);
      patients.push(patient); owners.push(owner);
      for (const actor of [owner, caregiver]) f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(actor, actor, at('00:00'));
      f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
        VALUES(?,?,'Synthetic pilot profile','2026-10-26',?,?,'load_seed')`).run(patient, owner, at('00:00'), at('00:00'));
      f.sql.prepare(`INSERT INTO care_members VALUES(?,?,'owner',NULL),(?,?,'caregiver',NULL)`).run(patient, owner, patient, caregiver);
      f.sql.prepare('INSERT INTO care_schedules(patient_id,current_version) VALUES(?,1)').run(patient);
      for (let medication = 0; medication < 20; medication++) {
        f.sql.prepare(`INSERT INTO medication_schedules VALUES(?,?,'Synthetic medication','Typed label only',?,
          '[0,1,2,3,4,5,6]','2026-10-26',NULL,1,1,0)`)
          .run(`schedule_${index}_${medication}`, patient, JSON.stringify(times));
      }
      assert.deepEqual(await materializePatient(f.db, patient, at('07:00')), { dosesChanged: 320, notificationsCreated: 640 });
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules').get().n, 200);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dose_records').get().n, 3200);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 6400);
    for (const patient of patients) assert.deepEqual(await materializePatient(f.db, patient, at('07:01')), { dosesChanged: 0, notificationsCreated: 0 });
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM (SELECT patient_id,dose_id,COUNT(*) AS copies
      FROM dose_records GROUP BY patient_id,dose_id HAVING copies<>1)`).get().n, 0);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM (SELECT patient_id,dose_id,recipient_actor_id,kind,COUNT(*) AS copies
      FROM notification_outbox GROUP BY patient_id,dose_id,recipient_actor_id,kind HAVING copies<>1)`).get().n, 0);

    const recovered = [];
    const recoveryEnv = { DB: f.db, SCHEDULER_ENABLED: 'true', PATIENT_CLOCK: {
      idFromName: value => value, get: value => ({ fetch: async () => { recovered.push(value); return new Response(null, { status: 202 }); } }),
    } };
    assert.deepEqual(await recoverSchedules(recoveryEnv, at('07:05')), { checked: 10, failed: 0 });
    assert.deepEqual([...new Set(recovered)].sort(), patients);

    const config = { SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'true', APP_ORIGIN: 'https://example.test',
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-never-live', LIVE_LINE_RECIPIENTS: JSON.stringify(owners) };
    let pushes = 0;
    const recipients = new Map();
    const keys = new Set();
    const mockLine = async (url, request) => {
      assert.equal(url, 'https://api.line.me/v2/bot/message/push');
      const payload = JSON.parse(request.body);
      assert.ok(owners.includes(payload.to));
      assert.ok(!request.body.includes('Synthetic'));
      assert.ok(!keys.has(request.headers['x-line-retry-key']));
      keys.add(request.headers['x-line-retry-key']);
      recipients.set(payload.to, (recipients.get(payload.to) ?? 0) + 1);
      pushes++;
      return new Response('{}');
    };
    // Eight simultaneously due times ×20 schedules =160 candidate owner intents
    // per profile. Ten jobs/wake keeps each individual worker operation bounded.
    for (const patient of patients) for (let wake = 0; wake < 17; wake++) {
      await deliverPatientOutbox(f.db, patient, at('08:07'), config, { clock: () => at('08:07'), fetcher: mockLine });
    }
    assert.equal(pushes, 100);
    assert.equal(keys.size, 100);
    assert.equal(recipients.size, 5);
    assert.ok([...recipients.values()].every(value => value === 20));
    assert.equal(f.sql.prepare('SELECT SUM(attempts) AS n FROM notification_outbox').get().n, 100);
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM notification_outbox WHERE status='sent'`).get().n, 100);
    const day = Math.floor((at('08:07') + 25200000) / 86400000);
    assert.equal(f.sql.prepare('SELECT used FROM delivery_budget WHERE bucket=?').get(String(day)).used, 100);
    const recipientBudgets = f.sql.prepare('SELECT used FROM delivery_budget WHERE bucket LIKE ?').all(`${day}:%`);
    assert.equal(recipientBudgets.length, 5);
    assert.ok(recipientBudgets.every(row => row.used === 20));
    assert.equal(f.sql.prepare(`SELECT COUNT(*) AS n FROM notification_outbox WHERE status='dead' AND last_code='QUOTA'`).get().n, 1500);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dose_records').get().n, 3200);
    assert.equal(unexpectedNetwork, 0);
    const cpu = process.cpuUsage(cpuStarted);
    t.diagnostic(JSON.stringify({ environment: 'local SQLite; mock LINE only', profiles: 10, schedules: 200,
      dailyTimes: 8, doses: 3200, outboxIntents: 6400, mockPushes: pushes,
      elapsedMs: Math.round(performance.now() - started), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));
  } finally { f.close(); }
});
