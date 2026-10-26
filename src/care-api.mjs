import { applyDoseCommand } from './dose-store.mjs';

export const CONSENT_VERSION = '2026-10-26';
export const MAX_MEDICATIONS = 20;
export const MAX_CAREGIVERS = 5;
const INVITE_TTL = 15 * 60 * 1000;
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const json = (status, value, patientId) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    ...(patientId ? { 'x-nongoon-wake-patient': patientId } : {}) } });
class CareError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new CareError(status, code); };
const statement = (db, sql, args = []) => db.prepare(sql).bind(...args);
async function rows(db, sql, args = []) {
  const result = await statement(db, sql, args).all();
  if (result?.success !== true || !Array.isArray(result.results)) throw Error('DB_UNAVAILABLE');
  return result.results;
}
async function batch(db, statements) {
  const result = await db.batch(statements);
  if (!Array.isArray(result) || result.length !== statements.length || result.some(r => r?.success !== true)) throw Error('DB_UNAVAILABLE');
  return result;
}
const changed = result => result?.meta?.changes === 1;
async function body(request, allowed) {
  if (!request.headers.get('content-type')?.split(';')[0].trim().toLowerCase().endsWith('/json')) fail(415, 'JSON_REQUIRED');
  let data;
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_BODY');
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 16384) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof CareError) throw error; fail(400, 'INVALID_BODY'); }
  finally { reader.releaseLock(); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) fail(400, 'INVALID_BODY');
  return data;
}
function cleanText(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || (!empty && !value.trim())) fail(400, 'INVALID_INPUT');
  return value.trim();
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
export function validateSchedule(value, now) {
  const label = cleanText(value.label, 120), instructions = cleanText(value.instructions ?? '', 500, true);
  if (!Array.isArray(value.times) || value.times.length < 1 || value.times.length > 8
    || value.times.some(t => typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    || new Set(value.times).size !== value.times.length) fail(400, 'INVALID_TIMES');
  if (!Array.isArray(value.weekdays) || value.weekdays.length < 1 || value.weekdays.length > 7
    || value.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)
    || new Set(value.weekdays).size !== value.weekdays.length) fail(400, 'INVALID_WEEKDAYS');
  if (!validDate(value.startDate) || (value.endDate !== null && value.endDate !== undefined && !validDate(value.endDate))) fail(400, 'INVALID_DATE');
  const today = new Date(now + 7 * 3600000).toISOString().slice(0, 10);
  const endDate = value.endDate ?? null;
  // Starting in the past is permitted for an existing prescription, but never
  // materializes backdated reminders. The scheduler applies the late-job policy.
  if (value.startDate < '2020-01-01' || value.startDate > '2100-12-31'
    || (endDate !== null && (endDate < value.startDate || endDate < today || endDate > '2100-12-31'))) fail(400, 'INVALID_DATE');
  if (typeof value.active !== 'boolean' || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) fail(400, 'INVALID_VERSION');
  return { label, instructions, times: [...value.times].sort(), weekdays: [...value.weekdays].sort(),
    startDate: value.startDate, endDate, active: value.active, expectedVersion: value.expectedVersion };
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function secretCode() { return [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join(''); }
const accessSQL = `SELECT p.*,m.role,s.current_version FROM patients p
  JOIN care_members m ON m.patient_id=p.id JOIN accounts a ON a.actor_id=m.actor_id
  JOIN care_schedules s ON s.patient_id=p.id
  WHERE p.id=? AND m.actor_id=? AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND a.blocked_at IS NULL`;
async function access(db, patientId, actorId, owner = false) {
  const result = await rows(db, accessSQL, [patientId, actorId]);
  if (result.length !== 1 || (owner && (result[0].owner_actor_id !== actorId || result[0].role !== 'owner'))) fail(404, 'PATIENT_NOT_FOUND');
  return result[0];
}
const ownerGuard = `EXISTS(SELECT 1 FROM patients p JOIN care_members m ON m.patient_id=p.id
  JOIN accounts a ON a.actor_id=m.actor_id WHERE p.id=? AND p.owner_actor_id=? AND m.actor_id=?
  AND m.role='owner' AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND a.blocked_at IS NULL)`;
const ownerArgs = (patientId, actorId) => [patientId, actorId, actorId];
function patientValue(p) { return { id: p.id, displayName: p.display_name, role: p.role,
  currentVersion: p.current_version, consentVersion: p.consent_version, consentedAt: p.consented_at }; }
function scheduleValue(s) { return { id: s.id, patientId: s.patient_id, label: s.label, instructions: s.instructions,
  times: JSON.parse(s.times_json), weekdays: JSON.parse(s.weekdays_json), startDate: s.start_date,
  endDate: s.end_date, active: s.active === 1, version: s.version, updatedAt: s.updated_at }; }
function audit(db, patientId, actorId, action, resourceId, version, now, guard, args) {
  return statement(db, `INSERT INTO care_audit(event_id,patient_id,actor_id,action,resource_id,version,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${guard}`, [crypto.randomUUID(), patientId, actorId, action, resourceId, version, now, ...args]);
}
const mutationGuard = 'EXISTS(SELECT 1 FROM care_schedules WHERE patient_id=? AND mutation_id=?)';

async function createPatient(request, db, actorId, now) {
  const input = await body(request, ['displayName', 'consent', 'consentVersion']);
  const displayName = cleanText(input.displayName, 80);
  if (input.consent !== true || input.consentVersion !== CONSENT_VERSION) fail(400, 'CONSENT_REQUIRED');
  const patientId = crypto.randomUUID(), mutation = crypto.randomUUID();
  const result = await batch(db, [
    statement(db, `INSERT INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE actor_id=? AND blocked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM patients WHERE owner_actor_id=? AND revoked_at IS NULL)
      AND (SELECT COUNT(*) FROM patients WHERE owner_actor_id=?)<4
      AND (SELECT COUNT(*) FROM patients WHERE revoked_at IS NULL)<10`,
    [patientId, actorId, displayName, CONSENT_VERSION, now, now, mutation, actorId, actorId, actorId]),
    statement(db, `INSERT INTO care_members SELECT id,owner_actor_id,'owner',NULL FROM patients WHERE id=? AND mutation_id=?`, [patientId, mutation]),
    statement(db, `INSERT INTO care_schedules(patient_id,current_version,mutation_id) SELECT id,1,? FROM patients WHERE id=? AND mutation_id=?`, [mutation, patientId, mutation]),
    ...['report_taken', 'report_not_taken', 'cancel'].map(action => statement(db,
      `INSERT INTO care_grants SELECT id,owner_actor_id,?,NULL FROM patients WHERE id=? AND mutation_id=?`, [action, patientId, mutation])),
    audit(db, patientId, actorId, 'consent_granted', patientId, 1, now,
      'EXISTS(SELECT 1 FROM patients WHERE id=? AND mutation_id=?)', [patientId, mutation]),
  ]);
  if (!changed(result[0])) fail(409, 'PATIENT_OR_PILOT_LIMIT');
  return json(201, { patient: patientValue(await access(db, patientId, actorId)) }, patientId);
}
async function saveSchedule(request, db, patientId, scheduleId, actorId, now) {
  await access(db, patientId, actorId, true);
  const input = validateSchedule(await body(request,
    ['label','instructions','times','weekdays','startDate','endDate','active','expectedVersion']), now);
  const creating = !scheduleId;
  const nextId = scheduleId || crypto.randomUUID(), mutation = crypto.randomUUID(), nextVersion = input.expectedVersion + 1;
  if (!Number.isSafeInteger(nextVersion)) fail(400, 'INVALID_VERSION');
  const quota = creating ? `(SELECT COUNT(*) FROM medication_schedules WHERE patient_id=?)<100
    AND (?=0 OR (SELECT COUNT(*) FROM medication_schedules WHERE patient_id=? AND active=1)<?)`
    : `EXISTS(SELECT 1 FROM medication_schedules WHERE id=? AND patient_id=?)
    AND (?=0 OR (SELECT COUNT(*) FROM medication_schedules WHERE patient_id=? AND active=1 AND id<>?)<?)`;
  const quotaArgs = creating ? [patientId, +input.active, patientId, MAX_MEDICATIONS]
    : [nextId, patientId, +input.active, patientId, nextId, MAX_MEDICATIONS];
  const updateVersion = statement(db, `UPDATE care_schedules SET current_version=?,mutation_id=?
    WHERE patient_id=? AND current_version=? AND ${ownerGuard} AND ${quota}`,
    [nextVersion, mutation, patientId, input.expectedVersion, ...ownerArgs(patientId, actorId), ...quotaArgs]);
  const guardArgs = [patientId, mutation];
  const values = [input.label, input.instructions, JSON.stringify(input.times), JSON.stringify(input.weekdays),
    input.startDate, input.endDate, +input.active, nextVersion, now];
  const changeSchedule = creating ? statement(db,
    `INSERT INTO medication_schedules(id,patient_id,label,instructions,times_json,weekdays_json,start_date,end_date,active,version,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${mutationGuard}`, [nextId, patientId, ...values, ...guardArgs])
    : statement(db, `UPDATE medication_schedules SET label=?,instructions=?,times_json=?,weekdays_json=?,start_date=?,end_date=?,active=?,version=?,updated_at=?
      WHERE id=? AND patient_id=? AND ${mutationGuard}`, [...values, nextId, patientId, ...guardArgs]);
  const result = await batch(db, [updateVersion, changeSchedule,
    statement(db, `UPDATE medication_schedules SET version=? WHERE patient_id=? AND ${mutationGuard}`, [nextVersion, patientId, ...guardArgs]),
    audit(db, patientId, actorId, creating ? 'schedule_created' : 'schedule_updated', nextId, nextVersion, now, mutationGuard, guardArgs),
  ]);
  if (!changed(result[0])) fail(409, 'SCHEDULE_CONFLICT_OR_QUOTA');
  const schedule = (await rows(db, 'SELECT * FROM medication_schedules WHERE id=? AND patient_id=?', [nextId, patientId]))[0];
  return json(creating ? 201 : 200, { schedule: scheduleValue(schedule), currentVersion: nextVersion }, patientId);
}
async function createInvite(request, db, patientId, actorId, now) {
  await access(db, patientId, actorId, true);
  const input = await body(request, ['consent']);
  if (input.consent !== true) fail(400, 'SHARING_CONSENT_REQUIRED');
  const code = secretCode(), hash = await digest(code), expiresAt = now + INVITE_TTL;
  const inserted = `EXISTS(SELECT 1 FROM care_invites WHERE code_hash=?)`;
  const result = await batch(db, [
    statement(db, `INSERT INTO care_invites(code_hash,patient_id,owner_actor_id,consented_at,created_at,expires_at)
      SELECT ?,id,owner_actor_id,consented_at,?,? FROM patients WHERE id=? AND ${ownerGuard}
      AND (SELECT COUNT(*) FROM care_invites WHERE patient_id=? AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>?)<5
      AND (SELECT COUNT(*) FROM care_members WHERE patient_id=? AND role='caregiver' AND revoked_at IS NULL)<?`,
      [hash, now, expiresAt, patientId, ...ownerArgs(patientId, actorId), patientId, now, patientId, MAX_CAREGIVERS]),
    audit(db, patientId, actorId, 'sharing_invited', null, null, now, inserted, [hash]),
  ]);
  if (!changed(result[0])) fail(409, 'INVITE_QUOTA');
  return json(201, { code, expiresAt });
}
async function acceptInvite(request, db, actorId, now) {
  const input = await body(request, ['code']);
  if (typeof input.code !== 'string' || !/^[0-9a-f]{64}$/.test(input.code)) fail(400, 'INVALID_INVITE');
  const hash = await digest(input.code), claim = crypto.randomUUID();
  const result = await batch(db, [
    statement(db, `UPDATE care_invites SET consumed_at=?,consumed_by=?,claim_id=?
      WHERE code_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?
      AND owner_actor_id<>? AND EXISTS(SELECT 1 FROM accounts WHERE actor_id=? AND blocked_at IS NULL)
      AND EXISTS(SELECT 1 FROM patients p JOIN accounts a ON a.actor_id=p.owner_actor_id
        WHERE p.id=care_invites.patient_id AND p.revoked_at IS NULL AND p.owner_actor_id=care_invites.owner_actor_id
        AND p.consented_at=care_invites.consented_at AND a.blocked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM care_members m WHERE m.patient_id=care_invites.patient_id AND m.actor_id=? AND m.role='owner')
      AND (SELECT COUNT(*) FROM care_members m WHERE m.patient_id=care_invites.patient_id AND m.role='caregiver' AND m.revoked_at IS NULL)<?
      AND (SELECT COUNT(*) FROM care_members m WHERE m.actor_id=? AND m.role='caregiver' AND m.revoked_at IS NULL)<10`,
      [now, actorId, claim, hash, now, actorId, actorId, actorId, MAX_CAREGIVERS, actorId]),
    statement(db, `INSERT INTO care_members(patient_id,actor_id,role,revoked_at)
      SELECT patient_id,?,'caregiver',NULL FROM care_invites WHERE claim_id=? AND consumed_by=?
      ON CONFLICT(patient_id,actor_id) DO UPDATE SET revoked_at=NULL WHERE care_members.role='caregiver'`, [actorId, claim, actorId]),
    ...['report_taken','report_not_taken'].map(action => statement(db,
      `INSERT INTO care_grants(patient_id,actor_id,action,revoked_at)
      SELECT patient_id,?,?,NULL FROM care_invites WHERE claim_id=? AND consumed_by=?
      ON CONFLICT(patient_id,actor_id,action) DO UPDATE SET revoked_at=NULL`, [actorId, action, claim, actorId])),
    statement(db, `INSERT INTO care_audit(event_id,patient_id,actor_id,action,created_at)
      SELECT ?,patient_id,?,'sharing_accepted',? FROM care_invites WHERE claim_id=? AND consumed_by=?`,
      [crypto.randomUUID(), actorId, now, claim, actorId]),
  ]);
  if (!changed(result[0])) fail(409, 'INVITE_INVALID_OR_EXPIRED');
  const invite = (await rows(db, 'SELECT patient_id FROM care_invites WHERE claim_id=? AND consumed_by=?', [claim, actorId]))[0];
  return json(200, { patientId: invite.patient_id }, invite.patient_id);
}
async function revokeMember(db, patientId, memberId, actorId, now) {
  await access(db, patientId, actorId, true);
  if (memberId === actorId) fail(400, 'USE_WITHDRAW_CONSENT');
  const mutation = crypto.randomUUID();
  const result = await batch(db, [
    statement(db, `UPDATE care_schedules SET mutation_id=? WHERE patient_id=? AND ${ownerGuard}
      AND EXISTS(SELECT 1 FROM care_members WHERE patient_id=? AND actor_id=? AND role='caregiver' AND revoked_at IS NULL)`,
      [mutation, patientId, ...ownerArgs(patientId, actorId), patientId, memberId]),
    statement(db, `UPDATE care_members SET revoked_at=? WHERE patient_id=? AND actor_id=? AND role='caregiver' AND ${mutationGuard}`,
      [now, patientId, memberId, patientId, mutation]),
    // Invalidate unused invitations so a copied earlier code cannot undo revoke.
    statement(db, `UPDATE care_invites SET revoked_at=? WHERE patient_id=? AND consumed_at IS NULL AND ${mutationGuard}`, [now, patientId, patientId, mutation]),
    audit(db, patientId, actorId, 'sharing_revoked', memberId, null, now, mutationGuard, [patientId, mutation]),
  ]);
  if (!changed(result[0])) fail(404, 'MEMBER_NOT_FOUND');
  return json(200, { revoked: true }, patientId);
}
async function withdrawConsent(db, patientId, actorId, now) {
  await access(db, patientId, actorId, true);
  const mutation = crypto.randomUUID();
  const guard = 'EXISTS(SELECT 1 FROM patients WHERE id=? AND mutation_id=?)', args = [patientId, mutation];
  const result = await batch(db, [
    statement(db, `UPDATE patients SET revoked_at=?,mutation_id=? WHERE id=? AND ${ownerGuard}`,
      [now, mutation, patientId, ...ownerArgs(patientId, actorId)]),
    statement(db, `UPDATE care_members SET revoked_at=? WHERE patient_id=? AND ${guard}`, [now, patientId, ...args]),
    statement(db, `UPDATE care_grants SET revoked_at=? WHERE patient_id=? AND ${guard}`, [now, patientId, ...args]),
    statement(db, `UPDATE care_invites SET revoked_at=? WHERE patient_id=? AND ${guard}`, [now, patientId, ...args]),
    statement(db, `UPDATE care_schedules SET current_version=current_version+1,mutation_id=? WHERE patient_id=? AND ${guard}`, [mutation, patientId, ...args]),
    statement(db, `UPDATE medication_schedules SET active=0,version=(SELECT current_version FROM care_schedules WHERE patient_id=?),updated_at=?
      WHERE patient_id=? AND ${guard}`, [patientId, now, patientId, ...args]),
    audit(db, patientId, actorId, 'consent_withdrawn', patientId, null, now, guard, args),
  ]);
  if (!changed(result[0])) fail(404, 'PATIENT_NOT_FOUND');
  return json(200, { withdrawn: true }, patientId);
}

/** Only trusted server context may provide actorId/now. Root authenticates and checks CSRF. */
export async function handleCareApi(request, env, { actorId, now = Date.now() } = {}) {
  try {
    if (!id(actorId)) fail(401, 'AUTH_REQUIRED');
    if (!Number.isSafeInteger(now) || now < 0 || !env?.DB?.prepare || !env.DB.batch) throw Error('NOT_READY');
    const db = env.DB, url = new URL(request.url), method = request.method;
    const selfCareOnly = env.SELF_CARE_ONLY === 'true';
    if (selfCareOnly && method === 'POST' && (url.pathname === '/api/invites/accept' || /^\/api\/patients\/[^/]+\/invites$/.test(url.pathname))) fail(403, 'SHARING_DISABLED');
    const active = await rows(db, 'SELECT actor_id FROM accounts WHERE actor_id=? AND blocked_at IS NULL', [actorId]);
    if (active.length !== 1) fail(401, 'AUTH_REQUIRED');
    if (url.pathname === '/api/patients') {
      if (method === 'POST') return await createPatient(request, db, actorId, now);
      if (method === 'GET') return json(200, { patients: (await rows(db,
        `SELECT p.*,m.role,s.current_version FROM patients p JOIN care_members m ON m.patient_id=p.id
        JOIN accounts a ON a.actor_id=m.actor_id JOIN care_schedules s ON s.patient_id=p.id WHERE m.actor_id=? AND m.revoked_at IS NULL
        AND (?=0 OR (m.role='owner' AND p.owner_actor_id=m.actor_id)) AND p.revoked_at IS NULL AND a.blocked_at IS NULL ORDER BY p.created_at,p.id LIMIT 11`, [actorId, selfCareOnly ? 1 : 0])).map(patientValue) });
      fail(405, 'METHOD_NOT_ALLOWED');
    }
    if (url.pathname === '/api/invites/accept' && method === 'POST') return await acceptInvite(request, db, actorId, now);
    const match = /^\/api\/patients\/([A-Za-z0-9_-]{1,128})(?:\/(.*))?$/.exec(url.pathname);
    if (!match) fail(404, 'NOT_FOUND');
    const [, patientId, tail = ''] = match;
    if (selfCareOnly) await access(db, patientId, actorId, true);
    if (tail === 'consent' && method === 'DELETE') return await withdrawConsent(db, patientId, actorId, now);
    if (tail === 'invites' && method === 'POST') return await createInvite(request, db, patientId, actorId, now);
    const member = /^members\/([A-Za-z0-9_-]{1,128})$/.exec(tail);
    if (member && method === 'DELETE') return await revokeMember(db, patientId, member[1], actorId, now);
    if (tail === 'schedules' && method === 'POST') return await saveSchedule(request, db, patientId, null, actorId, now);
    const schedule = /^schedules\/([A-Za-z0-9_-]{1,128})$/.exec(tail);
    if (schedule && method === 'PUT') return await saveSchedule(request, db, patientId, schedule[1], actorId, now);
    const report = /^doses\/([A-Za-z0-9_-]{1,128})\/report$/.exec(tail);
    if (report && method === 'POST') {
      await access(db, patientId, actorId);
      const input = await body(request, ['type','commandId','scheduleVersion']);
      if (!['report_taken','report_not_taken'].includes(input.type) || !id(input.commandId)
        || !Number.isSafeInteger(input.scheduleVersion) || input.scheduleVersion < 1) fail(400, 'INVALID_COMMAND');
      try { return json(200, await applyDoseCommand(db, { ...input, patientId, doseId: report[1] }, { actorId, now }), patientId); }
      catch (error) { if (error.message === 'COMMAND_REJECTED') fail(409, 'COMMAND_REJECTED'); throw error; }
    }
    const patient = await access(db, patientId, actorId, ['members','export'].includes(tail));
    if (!tail && method === 'GET') return json(200, { patient: patientValue(patient), canManage: patient.role === 'owner' });
    if (tail === 'schedules' && method === 'GET') return json(200, {
      schedules: (await rows(db, `SELECT * FROM medication_schedules WHERE patient_id=? AND EXISTS(${accessSQL})
        ORDER BY active DESC,label,id LIMIT 100`, [patientId, patientId, actorId])).map(scheduleValue),
      currentVersion: patient.current_version });
    if (tail === 'members' && method === 'GET') return json(200, { members: (await rows(db,
      `SELECT actor_id AS actorId,role,revoked_at AS revokedAt FROM care_members WHERE patient_id=? AND ${ownerGuard}
        ORDER BY role DESC,actor_id LIMIT 100`, [patientId, ...ownerArgs(patientId, actorId)])) });
    if (tail === 'doses' && method === 'GET') return json(200, {
      doses: await rows(db, `SELECT d.dose_id AS doseId,d.patient_id AS patientId,d.schedule_version AS scheduleVersion,
        d.due_at AS dueAt,d.expires_at AS expiresAt,d.status,d.changed_at AS changedAt,d.schedule_id AS scheduleId,
        COALESCE(m.label,'รอบยาจากตารางเดิม') AS label,COALESCE(m.instructions,'') AS instructions
        FROM dose_records d LEFT JOIN medication_schedules m ON m.id=d.schedule_id
          AND m.patient_id=d.patient_id AND m.version=d.schedule_version
        WHERE d.patient_id=? AND d.expires_at>? AND d.due_at<? AND EXISTS(${accessSQL})
        ORDER BY d.due_at DESC,d.dose_id LIMIT 5000`,
        [patientId, now - 30*86400000, now + 2*86400000, patientId, actorId]), currentVersion: patient.current_version });
    if (tail === 'export' && method === 'GET') return json(200, {
      exportedAt: now, patient: patientValue(patient),
      schedules: (await rows(db, `SELECT * FROM medication_schedules WHERE patient_id=? AND ${ownerGuard}
        ORDER BY id LIMIT 100`, [patientId, ...ownerArgs(patientId, actorId)])).map(scheduleValue),
      doses: await rows(db, `SELECT dose_id AS doseId,schedule_version AS scheduleVersion,due_at AS dueAt,expires_at AS expiresAt,status,changed_at AS changedAt
        FROM dose_records WHERE patient_id=? AND ${ownerGuard} ORDER BY due_at DESC,dose_id LIMIT 5000`, [patientId, ...ownerArgs(patientId, actorId)]),
      audit: await rows(db, `SELECT action,resource_id AS resourceId,version,created_at AS createdAt FROM care_audit WHERE patient_id=?
        AND ${ownerGuard} ORDER BY created_at DESC,event_id LIMIT 5000`, [patientId, ...ownerArgs(patientId, actorId)]), bounded: true });
    fail(404, 'NOT_FOUND');
  } catch (error) {
    return json(error instanceof CareError ? error.status : 503,
      { error: error instanceof CareError ? error.code : 'CARE_SERVICE_UNAVAILABLE' });
  }
}
