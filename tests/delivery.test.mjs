import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.mjs';
import { materializePatient, bangkokInstant, nextWake } from '../src/scheduler.mjs';
import { deliveryConfig, notificationText, sendLineNotification, deliverPatientOutbox, LEASE_MS } from '../src/delivery.mjs';

const owner = `U${'1'.repeat(32)}`, caregiver = `U${'2'.repeat(32)}`;
const at = time => bangkokInstant('2026-10-26', time);
const env = { SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'true', APP_ORIGIN: 'https://example.test',
  LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-token-never-live', LIVE_LINE_RECIPIENTS: JSON.stringify([owner, caregiver]) };
async function fixture() {
  const f = createTestDb();
  for (const actor of [owner, caregiver]) f.sql.prepare('INSERT INTO accounts(actor_id,line_user_id,created_at) VALUES(?,?,?)').run(actor, actor, at('00:00'));
  f.sql.prepare(`INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
    VALUES('p1',?,'PRIVATE_PATIENT','2026-10-26',?,?,'seed')`).run(owner, at('00:00'), at('00:00'));
  f.sql.prepare("INSERT INTO care_members VALUES('p1',?,'owner',NULL),('p1',?,'caregiver',NULL)").run(owner, caregiver);
  f.sql.exec("INSERT INTO care_schedules(patient_id,current_version) VALUES('p1',1)");
  f.sql.exec(`INSERT INTO medication_schedules VALUES('s1','p1','PRIVATE_MEDICINE','PRIVATE_INSTRUCTIONS','["08:00"]','[0,1,2,3,4,5,6]','2026-10-26',NULL,1,1,0)`);
  await materializePatient(f.db, 'p1', at('07:00'));
  return f;
}
const deliver = (f, now = at('08:00'), options = {}, config = env) => deliverPatientOutbox(f.db, 'p1', now, config, { clock: () => now, ...options });
const ownerJob = f => f.sql.prepare("SELECT * FROM notification_outbox WHERE recipient_actor_id=? ORDER BY available_at LIMIT 1").get(owner);

test('delivery configuration fails closed without both gates, token and a bounded explicit allowlist', () => {
  assert.ok(deliveryConfig(env));
  for (const changes of [{ DELIVERY_ENABLED: 'false' }, { SCHEDULER_ENABLED: 'false' }, { APP_ORIGIN: 'http://example.test' },
    { APP_ORIGIN: 'https://example.test/' }, { LIVE_LINE_RECIPIENTS: '[]' }, { LIVE_LINE_RECIPIENTS: '["arbitrary"]' },
    { LIVE_LINE_RECIPIENTS: 'null' }, { LINE_CHANNEL_ACCESS_TOKEN: '' }]) assert.equal(deliveryConfig({ ...env, ...changes }), null);
  assert.ok(!notificationText('caregiver_alert', env.APP_ORIGIN).includes('PRIVATE'));
});

test('LINE adapter uses first-attempt retry key, timeout, fixed destination and generic content', async () => {
  let seen;
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const result = await sendLineNotification({ to: owner, retryKey: key, text: notificationText('reminder', env.APP_ORIGIN) }, {
    token: env.LINE_CHANNEL_ACCESS_TOKEN, fetcher: async (url, options) => { seen = { url, options }; return new Response('{}'); },
  });
  assert.equal(result.accepted, true);
  assert.equal(seen.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(seen.options.headers['x-line-retry-key'], key);
  assert.equal(seen.options.redirect, 'manual');
  assert.ok(seen.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(seen.options.body).messages, [{ type: 'text', text: notificationText('reminder', env.APP_ORIGIN) }]);
});

test('real SQL concurrent workers claim a single intent and never send medication/name data', async () => {
  const f = await fixture(); try {
    let calls = 0;
    const fetcher = async (_url, request) => { calls++; assert.ok(!request.body.includes('PRIVATE')); return new Response('{}'); };
    const results = await Promise.all([deliver(f, at('08:00'), { fetcher }), deliver(f, at('08:00'), { fetcher })]);
    assert.equal(calls, 1); assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
    assert.equal(ownerJob(f).status, 'sent');
    assert.equal(ownerJob(f).attempts, 1);
    assert.equal(f.sql.prepare('SELECT SUM(used) n FROM delivery_budget').get().n, 2);
    await deliver(f, at('08:01'), { fetcher }); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('network retry, crash recovery and accepted conflict reuse identical persisted key and payload', async () => {
  const f = await fixture(); try {
    const attempts = [];
    const fetcher = async (_url, request) => {
      attempts.push({ key: request.headers['x-line-retry-key'], body: request.body });
      if (attempts.length === 1) throw Error('private network detail');
      return new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': 'private-id-not-retained' } });
    };
    assert.equal((await deliver(f, at('08:00'), { fetcher })).retried, 1);
    assert.equal((await deliver(f, at('08:00') + 14_999, { fetcher })).sent, 0);
    assert.equal((await deliver(f, at('08:00') + 15_000, { fetcher })).sent, 1);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(ownerJob(f).last_code, 'ALREADY_ACCEPTED');
    assert.ok(!JSON.stringify(ownerJob(f)).includes('private'));
  } finally { f.close(); }

  const crash = await fixture(); try {
    let sentKey;
    const realPrepare = crash.db.prepare;
    crash.db.prepare = query => {
      if (query.startsWith('UPDATE notification_outbox SET status=?,sent_at=')) return { bind() { return { async run() { throw Error('simulated DB outage'); } }; } };
      return realPrepare(query);
    };
    await assert.rejects(deliver(crash, at('08:00'), { fetcher: async (_url, request) => { sentKey = request.headers['x-line-retry-key']; return new Response('{}'); } }));
    assert.equal(ownerJob(crash).status, 'sending');
    crash.db.prepare = realPrepare;
    let retries = 0;
    const fetcher = async (_url, request) => { retries++; assert.equal(request.headers['x-line-retry-key'], sentKey); return new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': 'already' } }); };
    await deliver(crash, at('08:00') + LEASE_MS - 1, { fetcher }); assert.equal(retries, 0);
    await deliver(crash, at('08:00') + LEASE_MS, { fetcher }); assert.equal(retries, 1);
    assert.equal(ownerJob(crash).status, 'sent');
  } finally { crash.close(); }
});

test('revoked consent/member, blocked accounts, reports and stale versions prevent sends', async () => {
  for (const mutation of ["UPDATE patients SET revoked_at=1", "UPDATE accounts SET blocked_at=1", "UPDATE care_members SET revoked_at=1",
    "UPDATE care_schedules SET current_version=2", "UPDATE medication_schedules SET active=0",
    `UPDATE dose_records SET status='reported_taken',command_id='synthetic-report',actor_id='${owner}',changed_at=${at('08:00')} WHERE due_at=${at('08:00')}`]) {
    const f = await fixture(); try {
      f.sql.exec(mutation); let calls = 0;
      await deliver(f, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } });
      assert.equal(calls, 0); assert.equal(ownerJob(f).status, 'cancelled');
    } finally { f.close(); }
  }
});

test('revocation after claim and clock expiry between jobs are checked immediately before HTTP', async () => {
  const f = await fixture(); try {
    const prepare = f.db.prepare;
    f.db.prepare = query => {
      if (query.startsWith('SELECT id FROM notification_outbox')) f.sql.exec('UPDATE patients SET revoked_at=1');
      return prepare(query);
    };
    let calls = 0;
    await deliver(f, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 0); assert.equal(ownerJob(f).status, 'cancelled');
  } finally { f.close(); }
  const expired = await fixture(); try {
    let calls = 0;
    await deliver(expired, at('08:00'), { clock: () => at('08:16'), fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 0);
    await deliver(expired, at('08:16'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(ownerJob(expired).status, 'dead');
    assert.equal(ownerJob(expired).last_code, 'LATE');
  } finally { expired.close(); }
});

test('caregiver receives no-response alert only at +30min, and reporting suppresses it', async () => {
  const f = await fixture(); try {
    const recipients = [];
    const fetcher = async (_url, request) => { recipients.push(JSON.parse(request.body).to); return new Response('{}'); };
    await deliver(f, at('08:00'), { fetcher });
    await deliver(f, at('08:29'), { fetcher }); assert.deepEqual(recipients, [owner]);
    await deliver(f, at('08:30'), { fetcher }); assert.deepEqual(recipients, [owner, caregiver]);
  } finally { f.close(); }
  const reported = await fixture(); try {
    reported.sql.prepare(`UPDATE dose_records SET status='reported_not_taken',command_id='report',actor_id=?,changed_at=? WHERE due_at=?`).run(owner, at('08:05'), at('08:00'));
    let calls = 0;
    await deliver(reported, at('08:30'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 0);
  } finally { reported.close(); }
});

test('five attempts exhaust safely, HTTP4xx do not retry, and changed payload never reuses key', async () => {
  const f = await fixture(); try {
    let time = at('08:00'), calls = 0;
    for (let n = 0; n < 5; n++) {
      await deliver(f, time, { fetcher: async () => { calls++; return new Response('{}', { status: 503 }); } });
      time += 15_000 * 2 ** n;
    }
    assert.equal(calls, 5); assert.equal(ownerJob(f).status, 'dead'); assert.equal(ownerJob(f).attempts, 5);
  } finally { f.close(); }
  for (const status of [400, 401, 403, 409, 429]) {
    const bad = await fixture(); try {
      const result = await deliver(bad, at('08:00'), { fetcher: async () => new Response('{}', { status }) });
      assert.equal(result.dead, 1); assert.equal(ownerJob(bad).status, 'dead');
    } finally { bad.close(); }
  }
  const changed = await fixture(); try {
    await deliver(changed, at('08:00'), { fetcher: async () => { throw Error(); } });
    let calls = 0;
    await deliver(changed, at('08:01'), { fetcher: async () => { calls++; return new Response('{}'); } }, { ...env, APP_ORIGIN: 'https://changed.test' });
    assert.equal(calls, 0); assert.equal(ownerJob(changed).last_code, 'PAYLOAD_OR_KEY_CHANGED');
  } finally { changed.close(); }
});

test('hard pilot attempts budget caps each recipient/day and all recipients/day atomically', async () => {
  const f = await fixture(); try {
    for (let n = 0; n < 21; n++) f.sql.prepare(`INSERT INTO dose_records(patient_id,dose_id,schedule_version,due_at,expires_at,schedule_id)
      VALUES('p1',?,1,?,?,'s1')`).run(`load_${n}`, at('08:00'), at('10:00'));
    await materializePatient(f.db, 'p1', at('08:00'));
    let calls = 0;
    for (let n = 0; n < 4; n++) await deliver(f, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 20);
    const day = Math.floor((at('08:00') + 25200000) / 86400000);
    assert.equal(f.sql.prepare('SELECT used FROM delivery_budget WHERE bucket=?').get(`${day}:${owner}`).used, 20);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status='dead' AND last_code='QUOTA'").get().n, 2);
  } finally { f.close(); }
  const capped = await fixture(); try {
    const day = Math.floor((at('08:00') + 25200000) / 86400000);
    capped.sql.prepare('INSERT INTO delivery_budget VALUES(?,?,100)').run(String(day), day);
    let calls = 0;
    const result = await deliver(capped, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 0); assert.equal(result.quotaLimited, true); assert.equal(ownerJob(capped).attempts, 0);
  } finally { capped.close(); }
});

test('allowlist excluded jobs never block allowed recipients or cause one-second alarms', async () => {
  const f = await fixture(); try {
    let calls = 0;
    const limited = { ...env, LIVE_LINE_RECIPIENTS: JSON.stringify([caregiver]) };
    await deliver(f, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } }, limited);
    assert.equal(calls, 0);
    assert.equal(await nextWake(f.db, 'p1', at('08:00'), { recipients: [caregiver] }), at('08:30'));
    assert.ok((await nextWake(f.db, 'p1', at('08:00'), { recipients: [] })) > at('08:30'));
  } finally { f.close(); }
});

test('pause/resume and revoke/reinvite safely rearm future unattempted intents without duplicates', async () => {
  const f = await fixture(); try {
    const key = ownerJob(f).id;
    f.sql.exec('UPDATE medication_schedules SET active=0,version=2; UPDATE care_schedules SET current_version=2');
    await deliver(f, at('07:10'), { fetcher: async () => { assert.fail('nothing due'); } });
    assert.equal(ownerJob(f).status, 'cancelled');
    f.sql.exec('UPDATE medication_schedules SET active=1,version=3; UPDATE care_schedules SET current_version=3');
    await materializePatient(f.db, 'p1', at('07:20'));
    assert.equal(ownerJob(f).status, 'pending'); assert.equal(ownerJob(f).id, key); assert.equal(ownerJob(f).schedule_version, 3);
    f.sql.prepare("UPDATE care_members SET revoked_at=1 WHERE actor_id=?").run(caregiver);
    await deliver(f, at('07:21'), { fetcher: async () => { assert.fail('nothing due'); } });
    f.sql.prepare("UPDATE care_members SET revoked_at=NULL WHERE actor_id=?").run(caregiver);
    await materializePatient(f.db, 'p1', at('07:22'));
    let calls = 0;
    await deliver(f, at('08:00'), { fetcher: async () => { calls++; return new Response('{}'); } });
    await deliver(f, at('08:30'), { fetcher: async () => { calls++; return new Response('{}'); } });
    assert.equal(calls, 2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status='sent'").get().n, 2);
    await materializePatient(f.db, 'p1', at('08:31'));
    assert.equal(ownerJob(f).status, 'sent'); assert.equal(ownerJob(f).attempts, 1);
  } finally { f.close(); }
});


test('LINE push redirects are terminal and never forwarded to another origin', async () => {
  let calls = 0;
  const result = await sendLineNotification({ to: owner, retryKey: '123e4567-e89b-42d3-a456-426614174000', text: 'test reminder' }, {
    token: env.LINE_CHANNEL_ACCESS_TOKEN,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.line.me/v2/bot/message/push');
      assert.equal(options.redirect, 'manual');
      return new Response('private', { status: 307, headers: { location: 'https://untrusted.example/collect' } });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { accepted: false, retryable: false, code: 'REJECTED' });
});


test('lease ownership ignores D1 trigger-inclusive change counts', async () => {
  const f = await fixture();
  try {
    const db = { prepare(query) {
      const statement = f.db.prepare(query);
      if (!query.includes("attempts=attempts+1")) return statement;
      return { bind(...args) {
        const bound = statement.bind(...args);
        return { ...bound, async all() {
          const result = await bound.all();
          return { ...result, meta: { ...result.meta, changes: result.results.length ? 3 : 0 } };
        }, async run() {
          const result = await bound.run();
          return { ...result, meta: { ...result.meta, changes: result.meta.changes ? 3 : 0 } };
        } };
      } };
    } };
    let calls = 0;
    const result = await deliverPatientOutbox(db, 'p1', at('08:00'), env, {
      clock: () => at('08:00'), fetcher: async () => { calls++; return new Response('{}'); },
    });
    assert.equal(calls, 1);
    assert.equal(result.sent, 1);
    assert.equal(ownerJob(f).status, 'sent');
    assert.equal(ownerJob(f).attempts, 1);
  } finally { f.close(); }
});
