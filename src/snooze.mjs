export const SNOOZE_MS = 15 * 60_000;
// One child per reminder generation; webhook redelivery cannot move its deadline.
export async function snoozeLineDose(db, jobId, lineUserId, now) {
  if (!/^[0-9a-f-]{36}$/.test(jobId) || !/^U[0-9a-f]{32}$/.test(lineUserId)
    || !Number.isSafeInteger(now) || now < 0) throw Error('INVALID_SNOOZE');
  const authorization = `FROM notification_outbox o
    JOIN dose_records d ON d.patient_id=o.patient_id AND d.dose_id=o.dose_id
    JOIN patients p ON p.id=o.patient_id JOIN accounts a ON a.actor_id=p.owner_actor_id
    JOIN care_members g ON g.patient_id=p.id AND g.actor_id=a.actor_id
    JOIN care_schedules c ON c.patient_id=p.id
    JOIN medication_schedules m ON m.id=d.schedule_id AND m.patient_id=p.id
    WHERE o.id=? AND o.kind='reminder' AND o.status='sent' AND o.recipient_actor_id=a.actor_id
      AND a.line_user_id=? AND a.blocked_at IS NULL AND p.revoked_at IS NULL
      AND g.role='owner' AND g.revoked_at IS NULL AND d.status='pending'
      AND d.due_at<=? AND d.expires_at>? AND c.current_version=d.schedule_version
      AND o.schedule_version=d.schedule_version AND m.version=d.schedule_version AND m.active=1
      AND EXISTS(SELECT 1 FROM care_grants x WHERE x.patient_id=p.id AND x.actor_id=a.actor_id
        AND x.action='report_taken' AND x.revoked_at IS NULL)`;
  const childId=crypto.randomUUID(), wakeAt=now+SNOOZE_MS;
  const insert=db.prepare(`INSERT INTO notification_outbox
    (id,patient_id,dose_id,schedule_version,recipient_actor_id,kind,available_at,expires_at,created_at,generation)
    SELECT ?,o.patient_id,o.dose_id,o.schedule_version,o.recipient_actor_id,'reminder',?,MIN(d.expires_at,?),?,o.generation+1
    ${authorization} AND o.generation<8
    ON CONFLICT(patient_id,dose_id,recipient_actor_id,kind,generation) DO NOTHING`)
    .bind(childId,wakeAt,wakeAt+15*60_000,now,jobId,lineUserId,now,wakeAt);
  const receipt=db.prepare(`SELECT child.available_at AS wakeAt,o.patient_id AS patientId
    ${authorization} AND EXISTS(SELECT 1 FROM notification_outbox child
      WHERE child.patient_id=o.patient_id AND child.dose_id=o.dose_id
        AND child.recipient_actor_id=o.recipient_actor_id AND child.kind='reminder' AND child.generation=o.generation+1)`
    .replace('SELECT child.available_at AS wakeAt,o.patient_id AS patientId',`SELECT (SELECT child.available_at FROM notification_outbox child WHERE child.patient_id=o.patient_id
      AND child.dose_id=o.dose_id AND child.recipient_actor_id=o.recipient_actor_id AND child.kind='reminder'
      AND child.generation=o.generation+1) AS wakeAt,o.patient_id AS patientId`))
    .bind(jobId,lineUserId,now,now);
  const result=await db.batch([insert,receipt]);
  if(result.some(r=>r.success!==true))throw Error('SNOOZE_STORAGE_FAILED');
  return result[1].results?.[0]??null;
}
