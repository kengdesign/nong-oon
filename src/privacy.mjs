export const DAY = 86400000;
export const HISTORY_RETENTION_DAYS = 90;
export const WITHDRAWAL_RETENTION_DAYS = 30;
const LIMIT = 100;
const tableLimit = table => table === 'notification_outbox' ? 1000 : table === 'api_rate_limits' ? 2000 : LIMIT;
// Table/column names are static developer-owned SQL; all runtime values are bound.
// Every table operation is bounded, preventing an hourly unbounded delete.
export async function purgePrivateData(db, now) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('INVALID_PURGE_INPUT');
  const history = now - HISTORY_RETENTION_DAYS * DAY;
  const withdrawn = now - WITHDRAWAL_RETENTION_DAYS * DAY;
  const specs = [
    ['sessions', 'session_hash', 'expires_at<=?', [now]],
    ['oauth_states', 'state_hash', 'expires_at<=?', [now]],
    ['auth_rate_limits', 'rate_hash', 'expires_at<=?', [now]],
    ['api_rate_limits', 'bucket', 'expires_at<=?', [now]],
    ['care_invites', 'code_hash', 'expires_at<=?', [now]],
    ['service_admin_invites', 'code_hash', 'expires_at<=?', [now]],
    ['service_admins', 'actor_id', 'revoked_at<=?', [withdrawn]],
    ['service_admin_audit', 'event_id', 'created_at<=?', [history]],
    ['care_members', 'rowid', "revoked_at<=? AND role='caregiver'", [withdrawn]],
    ['care_grants', 'rowid', `revoked_at<=? AND NOT EXISTS(SELECT 1 FROM care_members m
      WHERE m.patient_id=care_grants.patient_id AND m.actor_id=care_grants.actor_id AND m.revoked_at IS NULL)`, [withdrawn]],
    ['notification_outbox', 'id', "expires_at<=? AND (status<>'sending' OR lease_until<=?)", [now - 7*DAY, now]],
    ['dose_audit', 'command_id', 'changed_at<=?', [history]],
    ['dose_records', 'rowid', 'expires_at<=?', [history]],
    ['care_audit', 'event_id', 'created_at<=?', [history]],
    ['delivery_budget', 'rowid', 'day<?', [Math.floor((now + 7*3600000)/DAY) - 7]],
    // Withdrawn patients are invisible immediately. Delete dependencies in bounded
    // batches; leave the patient tombstone until all its dependencies are gone.
    ...[['notification_outbox','id'], ['dose_audit','command_id'], ['dose_records','rowid'],
      ['care_invites','code_hash'], ['medication_schedules','id'], ['care_grants','rowid'],
      ['care_members','rowid'], ['care_schedules','patient_id']].map(([table, key]) =>
      [table, key, 'patient_id IN (SELECT id FROM patients WHERE revoked_at<=? ORDER BY revoked_at,id LIMIT 100)', [withdrawn]]),
    ['patients', 'id', `revoked_at<=? AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM dose_records d WHERE d.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM dose_audit d WHERE d.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM care_invites i WHERE i.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM medication_schedules m WHERE m.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM care_members m WHERE m.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM care_grants g WHERE g.patient_id=patients.id)
      AND NOT EXISTS(SELECT 1 FROM care_schedules s WHERE s.patient_id=patients.id)`, [withdrawn]],
  ];
  const statements = specs.map(([table,key,condition,args]) => db.prepare(
    `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${condition} ORDER BY ${key} LIMIT ${tableLimit(table)})`
  ).bind(...args));
  const results = await db.batch(statements);
  if (!Array.isArray(results) || results.length !== statements.length || results.some((r,i) => r.success !== true
    || !Number.isInteger(r.meta?.changes) || r.meta.changes < 0 || r.meta.changes > tableLimit(specs[i][0])))
    throw Error('PRIVATE_PURGE_FAILED');
  return { deleted: results.reduce((sum,r) => sum+r.meta.changes,0) };
}
