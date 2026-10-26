import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from './helpers/db.mjs';
import { materializePatient, bangkokInstant } from '../src/scheduler.mjs';
import { deliverPatientOutbox } from '../src/delivery.mjs';
import { applyDoseCommand } from '../src/dose-store.mjs';

const owner = `U${'1'.repeat(32)}`, caregiver = `U${'2'.repeat(32)}`;
const at = time => bangkokInstant('2026-10-26', time);
const env = { SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'true',
  APP_ORIGIN: 'https://example.test', LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-never-live',
  LIVE_LINE_RECIPIENTS: JSON.stringify([owner, caregiver]) };

// A separate restored SQLite connection receives the same D1-shaped API.
function asD1(sql) {
  const execute = (query, values, mode) => {
    const statement = sql.prepare(query);
    if (mode === 'first') return statement.get(...values) ?? null;
    if (statement.columns().length) return { success: true, results: statement.all(...values),
      meta: { changes: sql.prepare('SELECT changes() AS n').get().n } };
    return { success: true, results: [], meta: { changes: Number(statement.run(...values).changes) } };
  };
  const prepare = query => {
    const bound = values => ({ query, values,
      async first() { return execute(query, values, 'first'); },
      async all() { return execute(query, values, 'all'); },
      async run() { return execute(query, values, 'run'); },
    });
    return { ...bound([]), bind: (...values) => bound(values) };
  };
  return { prepare, async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ query, values }) => execute(query, values, 'all'));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
}

test('full-schema SQLite backup restores an isolated consistent care/audit/outbox snapshot with delivery off', async t => {
  const source = createTestDb();
  const directory = await mkdtemp(join(tmpdir(), 'nongoon-synthetic-restore-'));
  let restored;
  let unexpectedNetwork = 0;
  t.mock.method(globalThis, 'fetch', async () => { unexpectedNetwork++; throw Error('REAL_NETWORK_FORBIDDEN_IN_RESTORE_TEST'); });
  try {
    for (const actor of [owner, caregiver]) source.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(actor, actor, at('00:00'));
    source.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
      VALUES('restore_patient',?,'Synthetic restore profile','2026-10-26',?,?,'restore_seed')`).run(owner, at('00:00'), at('00:00'));
    source.sql.prepare(`INSERT INTO care_members VALUES('restore_patient',?,'owner',NULL),('restore_patient',?,'caregiver',NULL)`).run(owner, caregiver);
    for (const action of ['report_taken', 'report_not_taken', 'cancel']) source.sql.prepare(`INSERT INTO care_grants VALUES('restore_patient',?,?,NULL)`).run(owner, action);
    source.sql.exec(`INSERT INTO care_schedules(patient_id,current_version) VALUES('restore_patient',1);
      INSERT INTO medication_schedules VALUES('restore_schedule','restore_patient','Synthetic medication','Typed label only',
        '["08:00","18:00"]','[0,1,2,3,4,5,6]','2026-10-26',NULL,1,1,0);`);
    await materializePatient(source.db, 'restore_patient', at('07:00'));
    let sourceMockPushes = 0;
    const sent = await deliverPatientOutbox(source.db, 'restore_patient', at('08:00'), env,
      { clock: () => at('08:00'), fetcher: async () => { sourceMockPushes++; return new Response('{}'); } });
    assert.equal(sent.sent, 1);
    const morning = source.sql.prepare('SELECT dose_id FROM dose_records WHERE due_at=?').get(at('08:00'));
    await applyDoseCommand(source.db, { patientId: 'restore_patient', doseId: morning.dose_id,
      scheduleVersion: 1, commandId: 'restore_report_morning', type: 'report_taken' }, { actorId: owner, now: at('08:05') });
    await deliverPatientOutbox(source.db, 'restore_patient', at('08:30'), env,
      { clock: () => at('08:30'), fetcher: async () => assert.fail('reported dose must suppress caregiver alert') });
    assert.equal(sourceMockPushes, 1);
    const tables = ['accounts', 'patients', 'care_members', 'care_grants', 'care_schedules',
      'medication_schedules', 'dose_records', 'dose_audit', 'notification_outbox', 'delivery_budget'];
    const snapshot = Object.fromEntries(tables.map(table => [table, source.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

    // This is a real SQLite online backup followed by restoration into a new file.
    // It does not call or claim to test Cloudflare Time Travel.
    const backupPath = join(directory, 'synthetic-backup.sqlite');
    const restorePath = join(directory, 'synthetic-restored.sqlite');
    await backup(source.sql, backupPath);
    await copyFile(backupPath, restorePath);
    restored = new DatabaseSync(restorePath);
    restored.exec('PRAGMA foreign_keys=ON');
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
    for (const table of tables) assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), snapshot[table], `${table} snapshot`);
    assert.equal(restored.prepare(`SELECT COUNT(*) AS n FROM dose_records d JOIN dose_audit a
      ON a.command_id=d.command_id AND a.patient_id=d.patient_id AND a.dose_id=d.dose_id
      AND a.status=d.status AND a.actor_id=d.actor_id AND a.changed_at=d.changed_at`).get().n, 1);
    const restoredDb = asD1(restored);
    let restoredMockPushes = 0;
    const gated = await deliverPatientOutbox(restoredDb, 'restore_patient', at('18:00'),
      { ...env, DELIVERY_ENABLED: 'false', LIVE_LINE_RECIPIENTS: '[]' },
      { clock: () => at('18:00'), fetcher: async () => { restoredMockPushes++; return new Response('{}'); } });
    assert.equal(gated.deliverySkipped, true);
    assert.equal(restoredMockPushes, 0);
    assert.equal(restored.prepare(`SELECT COUNT(*) AS n FROM notification_outbox WHERE status='sent'`).get().n, 1);
    // The persisted sent receipt/retry key survives intact; restore never resets it.
    assert.equal(restored.prepare(`SELECT id FROM notification_outbox WHERE status='sent'`).get().id,
      source.sql.prepare(`SELECT id FROM notification_outbox WHERE status='sent'`).get().id);

    const evening = restored.prepare('SELECT dose_id FROM dose_records WHERE due_at=?').get(at('18:00'));
    await applyDoseCommand(restoredDb, { patientId: 'restore_patient', doseId: evening.dose_id,
      scheduleVersion: 1, commandId: 'restore_report_evening', type: 'report_not_taken' }, { actorId: owner, now: at('18:05') });
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM dose_audit').get().n, 2);
    assert.equal(source.sql.prepare('SELECT COUNT(*) AS n FROM dose_audit').get().n, 1, 'restored writes do not change source');
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(unexpectedNetwork, 0);
    t.diagnostic('Actual local SQLite backup/restore verified; no remote restore, no LINE traffic, delivery remained disabled on restored copy.');
  } finally {
    restored?.close();
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});
