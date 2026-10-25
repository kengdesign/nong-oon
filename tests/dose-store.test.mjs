import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyDoseCommand } from '../src/dose-store.mjs';
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0003_dose_reports.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO care_schedules VALUES('p1',1);
    INSERT INTO dose_records(patient_id,dose_id,schedule_version,due_at,expires_at) VALUES('p1','d1',1,100,200);
    INSERT INTO care_grants VALUES('p1','a1','report_taken',NULL),('p1','a1','report_not_taken',NULL),('p1','a1','cancel',NULL);`);
  const db = {
    prepare(query) { return { bind(...values) { return { query, values }; } }; },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map(({ query, values }) => {
          const stmt = sql.prepare(query);
          return query.startsWith('SELECT') ? { success: true, results: stmt.all(...values) }
            : { success: true, meta: { changes: stmt.run(...values).changes } };
        });
        sql.exec('COMMIT'); return results;
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
  return { sql, db, close() { sql.close(); } };
}
const command = { patientId: 'p1', doseId: 'd1', scheduleVersion: 1, commandId: 'cmd1', type: 'report_taken' };
const context = { actorId: 'a1', now: 150 };
const count = s => s.prepare('SELECT COUNT(*) AS n FROM dose_audit').get().n;
test('real SQL persists report and audit together and replay preserves first timestamp', async () => {
  const f = setup(); try {
    assert.deepEqual(await applyDoseCommand(f.db, command, context), { status: 'reported_taken', changedAt: 150 });
    assert.deepEqual(await applyDoseCommand(f.db, command, { ...context, now: 300 }), { status: 'reported_taken', changedAt: 150 });
    assert.equal(count(f.sql), 1);
    assert.equal(f.sql.prepare('SELECT status FROM dose_records').get().status, 'reported_taken');
  } finally { f.close(); }
});
test('revoked, absent and action-specific grants reject reports and replays', async () => {
  for (const grant of ['revoked', 'missing', 'wrong_action']) {
    const f = setup(); try {
      if (grant === 'revoked') f.sql.exec('UPDATE care_grants SET revoked_at=140');
      if (grant === 'missing') f.sql.exec('DELETE FROM care_grants');
      if (grant === 'wrong_action') f.sql.exec("DELETE FROM care_grants WHERE action='report_taken'");
      await assert.rejects(applyDoseCommand(f.db, command, context), /COMMAND_REJECTED/);
      assert.equal(count(f.sql), 0);
    } finally { f.close(); }
  }
  const f = setup(); try {
    await applyDoseCommand(f.db, command, context);
    f.sql.exec('UPDATE care_grants SET revoked_at=151');
    await assert.rejects(applyDoseCommand(f.db, command, context), /COMMAND_REJECTED/);
    assert.equal(count(f.sql), 1);
  } finally { f.close(); }
});
test('patient, schedule, time window and actor cannot be substituted', async () => {
  for (const [cmd, ctx] of [
    [{ ...command, patientId: 'p2' }, context],
    [{ ...command, scheduleVersion: 2 }, context],
    [command, { ...context, now: 99 }], [command, { ...context, now: 200 }],
    [command, { ...context, actorId: 'a2' }],
  ]) {
    const f = setup(); try {
      await assert.rejects(applyDoseCommand(f.db, cmd, ctx), /COMMAND_REJECTED/);
      assert.equal(count(f.sql), 0);
    } finally { f.close(); }
  }
});
test('conflicting queued reports result in one state and one audit', async () => {
  const f = setup(); try {
    const results = await Promise.allSettled([
      applyDoseCommand(f.db, command, context),
      applyDoseCommand(f.db, { ...command, commandId: 'cmd2', type: 'report_not_taken' }, context),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(count(f.sql), 1);
    await assert.rejects(applyDoseCommand(f.db, { ...command, type: 'report_not_taken' }, context), /COMMAND_REJECTED/);
  } finally { f.close(); }
});
test('audit failure rolls status back; storage errors are sanitized', async () => {
  const f = setup(); try {
    f.sql.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON dose_audit BEGIN SELECT RAISE(ABORT,'private SQL detail'); END;`);
    await assert.rejects(applyDoseCommand(f.db, command, context), e => e.message === 'DOSE_WRITE_FAILED');
    assert.equal(f.sql.prepare('SELECT status FROM dose_records').get().status, 'pending');
    assert.equal(count(f.sql), 0);
  } finally { f.close(); }
});
test('cancel is audited and prevents subsequent report; replay remains idempotent', async () => {
  const f = setup(); try {
    const cancel = { ...command, type: 'cancel' };
    assert.deepEqual(await applyDoseCommand(f.db, cancel, { ...context, now: 50 }), { status: 'cancelled', changedAt: 50 });
    await applyDoseCommand(f.db, cancel, context);
    await assert.rejects(applyDoseCommand(f.db, { ...command, commandId: 'cmd2' }, context), /COMMAND_REJECTED/);
    assert.equal(count(f.sql), 1);
  } finally { f.close(); }
});
test('invalid input never reaches storage', async () => {
  const db = { prepare() { assert.fail('must not touch database'); }, batch() {} };
  for (const cmd of [null, { ...command, commandId: '' }, { ...command, type: 'toString' }, { ...command, type: ['report_taken'] }, { ...command, scheduleVersion: 0 }])
    await assert.rejects(applyDoseCommand(db, cmd, context), /INVALID_COMMAND/);
});

test('schedule revision invalidates unmodified old doses and old receipts', async () => {
  for (const reported of [false, true]) {
    const f = setup(); try {
      if (reported) await applyDoseCommand(f.db, command, context);
      f.sql.exec('UPDATE care_schedules SET current_version=2');
      await assert.rejects(applyDoseCommand(f.db, command, context), /COMMAND_REJECTED/);
      assert.equal(count(f.sql), reported ? 1 : 0);
    } finally { f.close(); }
  }
});

test('reusing a command key for another dose rolls back the second update', async () => {
  const f = setup(); try {
    await applyDoseCommand(f.db, command, context);
    f.sql.exec("INSERT INTO dose_records(patient_id,dose_id,schedule_version,due_at,expires_at) VALUES('p1','d2',1,100,200)");
    await assert.rejects(applyDoseCommand(f.db, { ...command, doseId: 'd2' }, context), /DOSE_WRITE_FAILED/);
    assert.equal(f.sql.prepare("SELECT status FROM dose_records WHERE dose_id='d2'").get().status, 'pending');
    assert.equal(count(f.sql), 1);
  } finally { f.close(); }
});
