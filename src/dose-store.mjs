// Internal adapter only. actorId/now must come from the trusted server identity/clock,
// never from a request body. No HTTP entry point is enabled in this change.
const targets = { report_taken: 'reported_taken', report_not_taken: 'reported_not_taken', cancel: 'cancelled' };
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export async function applyDoseCommand(db, command, { actorId, now } = {}) {
  if (!command || !id(command.patientId) || !id(command.doseId) || !id(command.commandId)
    || typeof command.type !== 'string' || !Object.hasOwn(targets, command.type) || !id(actorId)
    || !Number.isSafeInteger(command.scheduleVersion) || command.scheduleVersion < 1
    || !Number.isSafeInteger(now) || now < 0) throw Error('INVALID_COMMAND');
  if (!db?.prepare || !db?.batch) throw Error('DB_NOT_READY');
  const { patientId, doseId, commandId, scheduleVersion, type } = command;
  const target = targets[type];
  // Authorization is rechecked inside the write, so a revoked grant cannot be
  // used through a stale preflight read. CAS resolves concurrent reports once.
  const update = db.prepare(`UPDATE dose_records SET status=?, command_id=?, actor_id=?, changed_at=?
    WHERE patient_id=? AND dose_id=? AND schedule_version=? AND status='pending'
    AND EXISTS(SELECT 1 FROM care_schedules s WHERE s.patient_id=dose_records.patient_id
      AND s.current_version=dose_records.schedule_version)
    AND (?='cancel' OR (due_at<=? AND expires_at>?))
    AND EXISTS(SELECT 1 FROM care_grants g WHERE g.patient_id=dose_records.patient_id
      AND g.actor_id=? AND g.action=? AND g.revoked_at IS NULL)`)
    .bind(target, commandId, actorId, now, patientId, doseId, scheduleVersion, type, now, now, actorId, type);
  // Replays return the original timestamp only for the same actor, command and
  // still-active permission. A reused key with different payload is rejected.
  const receipt = db.prepare(`SELECT a.status, a.changed_at AS changedAt FROM dose_audit a
    JOIN dose_records d ON d.patient_id=a.patient_id AND d.dose_id=a.dose_id
    WHERE a.command_id=? AND a.patient_id=? AND a.dose_id=? AND a.schedule_version=?
      AND d.schedule_version=a.schedule_version AND a.actor_id=? AND a.status=?
      AND EXISTS(SELECT 1 FROM care_schedules s WHERE s.patient_id=a.patient_id
        AND s.current_version=a.schedule_version)
      AND EXISTS(SELECT 1 FROM care_grants g WHERE g.patient_id=a.patient_id
        AND g.actor_id=? AND g.action=? AND g.revoked_at IS NULL)`)
    .bind(commandId, patientId, doseId, scheduleVersion, actorId, target, actorId, type);
  let results;
  try { results = await db.batch([update, receipt]); }
  catch { throw Error('DOSE_WRITE_FAILED'); }
  if (!Array.isArray(results) || results.length !== 2 || results.some(r => r.success !== true))
    throw Error('DOSE_WRITE_FAILED');
  const rows = results[1].results;
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('COMMAND_REJECTED');
  return { status: rows[0].status, changedAt: rows[0].changedAt };
}
