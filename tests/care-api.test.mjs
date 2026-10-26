import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleCareApi, validateSchedule } from '../src/care-api.mjs';

const owner = 'U' + '1'.repeat(32), caregiver = 'U' + '2'.repeat(32), outsider = 'U' + '3'.repeat(32);
const now = Date.parse('2026-10-26T01:00:00Z');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort())
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const execute = ({ query, values }) => {
    const stmt = sql.prepare(query);
    return stmt.columns().length ? { success: true, results: stmt.all(...values), meta: { changes: 0 } }
      : { success: true, results: [], meta: { changes: stmt.run(...values).changes } };
  };
  let beforeBatch;
  const db = {
    prepare(query) { return { bind(...values) { return { query, values,
      async all() { return execute({ query, values }); },
      async first() { return execute({ query, values }).results[0] ?? null; },
      async run() { return execute({ query, values }); },
    }; } }; },
    async batch(statements) {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
      sql.exec('BEGIN');
      try { const results = statements.map(execute); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  for (const actor of [owner, caregiver, outsider]) sql.prepare('INSERT INTO accounts(actor_id,line_user_id,blocked_at,created_at) VALUES(?,?,NULL,?)').run(actor, actor, now);
  return { sql, db, close() { sql.close(); }, beforeBatch(callback) { beforeBatch = callback; } };
}
const call = async (f, path, { actor = owner, method = 'GET', data, at = now, selfCareOnly = false } = {}) => {
  const request = new Request(`https://example.test/api${path}`, { method,
    headers: data === undefined ? {} : { 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const response = await handleCareApi(request, { DB: f.db, SELF_CARE_ONLY: selfCareOnly ? 'true' : 'false' }, { actorId: actor, now: at });
  return { status: response.status, data: await response.json(), wake: response.headers.get('x-nongoon-wake-patient') };
};
async function create(f) {
  const response = await call(f, '/patients', { method: 'POST', data: { displayName: 'ข้อมูลตัวอย่าง', consent: true, consentVersion: '2026-10-26' } });
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.data.patient.id;
}
const scheduleInput = (expectedVersion = 1) => ({ label: 'ยาตัวอย่าง', instructions: 'ตามฉลากที่ตรวจแล้ว',
  times: ['18:00', '08:00'], weekdays: [0,1,2,3,4,5,6], startDate: '2026-10-26', endDate: null, active: true, expectedVersion });
async function invite(f, patientId, actor = caregiver) {
  const response = await call(f, `/patients/${patientId}/invites`, { method: 'POST', data: { consent: true } });
  assert.equal(response.status, 201, JSON.stringify(response));
  const accepted = await call(f, '/invites/accept', { actor, method: 'POST', data: { code: response.data.code } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  return response.data;
}
function dose(f, patientId, doseId = 'dose1', version = 1) {
  f.sql.prepare('INSERT INTO dose_records(patient_id,dose_id,schedule_version,due_at,expires_at) VALUES(?,?,?,?,?)')
    .run(patientId, doseId, version, now - 1000, now + 60000);
}

test('self profile needs explicit current consent, creates owner-only grants and audit atomically', async () => {
  const f = fixture(); try {
    assert.equal((await call(f, '/patients', { method: 'POST', data: { displayName: 'test', consent: false, consentVersion: '2026-10-26' } })).status, 400);
    assert.equal((await call(f, '/patients', { method: 'POST', data: { displayName: 'test', consent: true, consentVersion: 'old' } })).status, 400);
    const patientId = await create(f);
    assert.equal((await call(f, '/patients')).data.patients.length, 1);
    assert.equal((await call(f, `/patients/${patientId}`)).data.canManage, true);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM care_grants').get().n, 3);
    assert.equal(f.sql.prepare('SELECT action FROM care_audit').get().action, 'consent_granted');
    assert.equal((await call(f, '/patients', { method: 'POST', data: { displayName: 'second', consent: true, consentVersion: '2026-10-26' } })).status, 409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM patients').get().n, 1);
  } finally { f.close(); }
});
test('unrelated accounts cannot enumerate profile, schedules, doses, members or export', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    assert.deepEqual((await call(f, '/patients', { actor: outsider })).data, { patients: [] });
    for (const tail of ['', '/schedules', '/doses', '/members', '/export'])
      assert.equal((await call(f, `/patients/${patientId}${tail}`, { actor: outsider })).status, 404);
    assert.equal((await call(f, `/patients/${patientId}/schedules`, { actor: outsider, method: 'POST', data: scheduleInput() })).status, 404);
  } finally { f.close(); }
});
test('schedule validation rejects impossible dates, duplicate slots, unchecked consent and client identity', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    for (const patch of [{ times: ['24:00'] }, { times: ['08:00','08:00'] }, { weekdays: [7] }, { weekdays: [1,1] },
      { startDate: '2026-02-30' }, { endDate: '2026-10-01' }, { active: 'true' }, { expectedVersion: 0 },
      { label: '' }, { actorId: outsider }]) {
      const response = await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: { ...scheduleInput(), ...patch } });
      assert.equal(response.status, 400, JSON.stringify(patch));
    }
    assert.equal(f.sql.prepare('SELECT current_version FROM care_schedules').get().current_version, 1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules').get().n, 0);
    assert.deepEqual(validateSchedule(scheduleInput(), now).times, ['08:00','18:00']);
  } finally { f.close(); }
});
test('all medication versions advance together, stale edits and racing writes cannot mutate schedules', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    const first = await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput() });
    assert.equal(first.status, 201); assert.equal(first.wake, patientId);
    assert.equal(first.data.currentVersion, 2);
    const writes = await Promise.all([
      call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: { ...scheduleInput(2), label: 'A' } }),
      call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: { ...scheduleInput(2), label: 'B' } }),
    ]);
    assert.deepEqual(writes.map(r => r.status).sort(), [201,409]);
    assert.deepEqual(f.sql.prepare('SELECT DISTINCT version FROM medication_schedules').all().map(r => r.version), [3]);
    const stale = await call(f, `/patients/${patientId}/schedules/${first.data.schedule.id}`, { method: 'PUT', data: scheduleInput(2) });
    assert.equal(stale.status, 409);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM care_audit WHERE action='schedule_created'").get().n, 2);
  } finally { f.close(); }
});
test('schedule quota is enforced inside transaction and pausing opens one active slot', async () => {
  const f = fixture(); try {
    const patientId = await create(f); let first;
    for (let i = 0; i < 20; i++) {
      const result = await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput(1+i) });
      assert.equal(result.status, 201); first ??= result.data.schedule.id;
    }
    assert.equal((await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput(21) })).status, 409);
    assert.equal((await call(f, `/patients/${patientId}/schedules/${first}`, { method: 'PUT', data: { ...scheduleInput(21), active: false } })).status, 200);
    assert.equal((await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput(22) })).status, 201);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules WHERE active=1').get().n, 20);
  } finally { f.close(); }
});
test('failed audit rolls profile and schedule writes back without database details', async () => {
  for (const which of ['profile','schedule']) {
    const f = fixture(); try {
      const patientId = which === 'schedule' ? await create(f) : null;
      f.sql.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON care_audit BEGIN SELECT RAISE(ABORT,'PRIVATE database detail'); END;");
      const response = which === 'profile'
        ? await call(f, '/patients', { method: 'POST', data: { displayName: 'test', consent: true, consentVersion: '2026-10-26' } })
        : await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput() });
      assert.equal(response.status, 503); assert.deepEqual(response.data, { error: 'CARE_SERVICE_UNAVAILABLE' });
      if (patientId) assert.equal(f.sql.prepare('SELECT current_version FROM care_schedules').get().current_version, 1);
      else assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM patients').get().n, 0);
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules').get().n, 0);
    } finally { f.close(); }
  }
});
test('invite code is hashed, single use, expires and can only grant read/report capabilities', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    assert.equal((await call(f, `/patients/${patientId}/invites`, { method: 'POST', data: { consent: false } })).status, 400);
    const invitation = await invite(f, patientId);
    const stored = f.sql.prepare('SELECT * FROM care_invites').get();
    assert.notEqual(stored.code_hash, invitation.code);
    assert.ok(!JSON.stringify(stored).includes(invitation.code));
    assert.equal((await call(f, '/invites/accept', { actor: outsider, method: 'POST', data: { code: invitation.code } })).status, 409);
    assert.equal((await call(f, `/patients/${patientId}`, { actor: caregiver })).data.canManage, false);
    assert.equal((await call(f, `/patients/${patientId}/schedules`, { actor: caregiver, method: 'POST', data: scheduleInput() })).status, 404);
    assert.equal((await call(f, `/patients/${patientId}/members`, { actor: caregiver })).status, 404);
    assert.deepEqual(f.sql.prepare('SELECT action FROM care_grants WHERE actor_id=? ORDER BY action').all(caregiver).map(r => r.action), ['report_not_taken','report_taken']);
    const expired = await call(f, `/patients/${patientId}/invites`, { method: 'POST', data: { consent: true } });
    assert.equal((await call(f, '/invites/accept', { actor: outsider, method: 'POST', data: { code: expired.data.code }, at: expired.data.expiresAt })).status, 409);
  } finally { f.close(); }
});
test('revocation immediately hides records, invalidates replay and all old invitation codes', async () => {
  const f = fixture(); try {
    const patientId = await create(f); await invite(f, patientId); dose(f, patientId);
    const report = { type: 'report_taken', commandId: 'command1', scheduleVersion: 1 };
    assert.equal((await call(f, `/patients/${patientId}/doses/dose1/report`, { actor: caregiver, method: 'POST', data: report })).status, 200);
    const pending = await call(f, `/patients/${patientId}/invites`, { method: 'POST', data: { consent: true } });
    assert.equal((await call(f, `/patients/${patientId}/members/${caregiver}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(f, `/patients/${patientId}/doses/dose1/report`, { actor: caregiver, method: 'POST', data: report })).status, 404);
    assert.equal((await call(f, `/patients/${patientId}/doses`, { actor: caregiver })).status, 404);
    assert.equal((await call(f, '/invites/accept', { actor: caregiver, method: 'POST', data: { code: pending.data.code } })).status, 409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dose_audit').get().n, 1);
  } finally { f.close(); }
});
test('withdrawal revokes all members/grants/invites, pauses schedules and increments revision atomically', async () => {
  const f = fixture(); try {
    const patientId = await create(f); await invite(f, patientId);
    await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput() });
    const pending = await call(f, `/patients/${patientId}/invites`, { method: 'POST', data: { consent: true } });
    assert.equal((await call(f, `/patients/${patientId}/consent`, { actor: caregiver, method: 'DELETE' })).status, 404);
    const withdrawn = await call(f, `/patients/${patientId}/consent`, { method: 'DELETE' });
    assert.equal(withdrawn.status, 200); assert.equal(withdrawn.wake, patientId);
    assert.equal((await call(f, `/patients/${patientId}`)).status, 404);
    assert.deepEqual((await call(f, '/patients')).data, { patients: [] });
    assert.equal((await call(f, '/invites/accept', { actor: outsider, method: 'POST', data: { code: pending.data.code } })).status, 409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM care_grants WHERE revoked_at IS NULL').get().n, 0);
    assert.equal(f.sql.prepare('SELECT active,version FROM medication_schedules').get().active, 0);
    assert.equal(f.sql.prepare('SELECT current_version FROM care_schedules').get().current_version, 3);
  } finally { f.close(); }
});
test('membership and consent are checked again inside writes after preflight is invalidated', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    f.beforeBatch(() => f.sql.prepare('UPDATE patients SET revoked_at=? WHERE id=?').run(now, patientId));
    const response = await call(f, `/patients/${patientId}/schedules`, { method: 'POST', data: scheduleInput() });
    assert.equal(response.status, 409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules').get().n, 0);
    assert.equal(f.sql.prepare('SELECT current_version FROM care_schedules').get().current_version, 1);
  } finally { f.close(); }
});
test('re-consent makes a fresh private profile without restoring withdrawn records or caregiver access', async () => {
  const f = fixture(); try {
    const oldId = await create(f); await invite(f, oldId); dose(f, oldId);
    await call(f, `/patients/${oldId}/schedules`, { method: 'POST', data: scheduleInput() });
    assert.equal((await call(f, `/patients/${oldId}/consent`, { method: 'DELETE' })).status, 200);
    const nextId = await create(f); assert.notEqual(nextId, oldId);
    assert.equal((await call(f, `/patients/${oldId}`)).status, 404);
    assert.equal((await call(f, `/patients/${nextId}`, { actor: caregiver })).status, 404);
    assert.deepEqual((await call(f, `/patients/${nextId}/schedules`)).data.schedules, []);
    assert.deepEqual((await call(f, `/patients/${nextId}/doses`)).data.doses, []);
    assert.deepEqual((await call(f, '/patients')).data.patients.map(p => p.id), [nextId]);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dose_records WHERE patient_id=?').get(oldId).n, 1);
    for (let i = 0, current = nextId; i < 2; i++) {
      await call(f, `/patients/${current}/consent`, { method: 'DELETE' }); current = await create(f);
    }
    const last = (await call(f, '/patients')).data.patients[0].id;
    await call(f, `/patients/${last}/consent`, { method: 'DELETE' });
    assert.equal((await call(f, '/patients', { method: 'POST', data: { displayName: 'new', consent: true, consentVersion: '2026-10-26' } })).status, 409);
  } finally { f.close(); }
});
test('dose reports reject client actor substitution, stale revisions, conflicting answer and revoked account', async () => {
  const f = fixture(); try {
    const patientId = await create(f); dose(f, patientId);
    const path = `/patients/${patientId}/doses/dose1/report`, input = { type: 'report_taken', commandId: 'command1', scheduleVersion: 1 };
    assert.equal((await call(f, path, { method: 'POST', data: { ...input, actorId: outsider } })).status, 400);
    assert.equal((await call(f, path, { method: 'POST', data: { ...input, scheduleVersion: 2 } })).status, 409);
    const result = await call(f, path, { method: 'POST', data: input }); assert.equal(result.status, 200);
    assert.equal((await call(f, path, { method: 'POST', data: input, at: now + 900000 })).data.changedAt, now);
    assert.equal((await call(f, path, { method: 'POST', data: { ...input, type: 'report_not_taken', commandId: 'command2' } })).status, 409);
    f.sql.prepare('UPDATE accounts SET blocked_at=? WHERE actor_id=?').run(now + 1, owner);
    assert.equal((await call(f, path, { method: 'POST', data: input })).status, 401);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM care_grants WHERE actor_id=? AND revoked_at IS NULL').get(owner).n, 0);
  } finally { f.close(); }
});
test('unknown JSON fields, oversized and malformed bodies return fixed errors without writes', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    for (const [body, status] of [['{', 400], [JSON.stringify({ ...scheduleInput(), instructions: 'x'.repeat(20000) }), 413]]) {
      const response = await handleCareApi(new Request(`https://example.test/api/patients/${patientId}/schedules`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body }), { DB: f.db }, { actorId: owner, now });
      assert.equal(response.status, status);
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM medication_schedules').get().n, 0);
  } finally { f.close(); }
});

// Synthetic actors in isolated SQLite; no LINE account or network required.
test('self-care pilot preserves owner access and rejects invitations and existing caregiver access', async () => {
  const f = fixture(); try {
    const patientId = await create(f);
    await invite(f, patientId); dose(f, patientId);
    const options = { selfCareOnly: true };
    assert.equal((await call(f, `/patients/${patientId}`, options)).status, 200);
    assert.equal((await call(f, `/patients/${patientId}/doses/dose1/report`, { ...options, method:'POST', data:{ type:'report_taken', commandId:'self_report', scheduleVersion:1 } })).status, 200);
    assert.equal((await call(f, `/patients/${patientId}/invites`, { ...options, method:'POST', data:{consent:true} })).status, 403);
    assert.equal((await call(f, '/invites/accept', { ...options, actor:outsider, method:'POST', data:{code:'a'.repeat(64)} })).status, 403);
    assert.equal((await call(f, `/patients/${patientId}`, { ...options, actor:caregiver })).status, 404);
    assert.deepEqual((await call(f, '/patients', { ...options, actor:caregiver })).data.patients, []);
    assert.equal((await call(f, '/patients', options)).data.patients.length, 1);
  } finally { f.close(); }
});
