import { deliverPatientOutbox } from './delivery.mjs';

export const DAY_MS = 86400000;
export const REPORT_WINDOW_MS = 2 * 60 * 60 * 1000;
export const ALERT_DELAY_MS = 30 * 60 * 1000;
export const LATE_WINDOW_MS = 15 * 60 * 1000;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validNow = now => Number.isSafeInteger(now) && now >= 0;
const checkResult = result => { if (result?.success !== true) throw Error('SCHEDULER_STORAGE_FAILED'); return result; };
const rows = async statement => { const result = checkResult(await statement.all()); if (!Array.isArray(result.results)) throw Error('SCHEDULER_STORAGE_FAILED'); return result.results; };
const uuidSQL = `lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',(random() & 3)+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))`;

export function bangkokDay(now) {
  if (!validNow(now)) throw Error('INVALID_CLOCK');
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function bangkokInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('INVALID_SCHEDULE');
  const value = Date.parse(`${date}T${time}:00+07:00`);
  if (!validNow(value) || bangkokDay(value) !== date) throw Error('INVALID_SCHEDULE');
  return value;
}
function safeSchedule(schedule) {
  let times, weekdays;
  try { times = JSON.parse(schedule.times_json); weekdays = JSON.parse(schedule.weekdays_json); } catch { throw Error('INVALID_STORED_SCHEDULE'); }
  if (!id(schedule.id) || !id(schedule.patient_id) || !Number.isSafeInteger(schedule.version) || schedule.version < 1
    || !Array.isArray(times) || times.length < 1 || times.length > 8 || new Set(times).size !== times.length
    || times.some(t => typeof t !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))
    || !Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7 || new Set(weekdays).size !== weekdays.length
    || weekdays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw Error('INVALID_STORED_SCHEDULE');
  bangkokInstant(schedule.start_date, '00:00');
  if (schedule.end_date !== null) {
    bangkokInstant(schedule.end_date, '00:00');
    if (schedule.end_date < schedule.start_date) throw Error('INVALID_STORED_SCHEDULE');
  }
  return { times, weekdays };
}
/** Forecast in Bangkok wall time; no medical interpretation or inferred frequency. */
export async function planOccurrences(schedules, now, days = 2) {
  if (!validNow(now) || !Array.isArray(schedules) || schedules.length > 20 || !Number.isInteger(days) || days < 1 || days > 8) throw Error('INVALID_SCHEDULE_INPUT');
  const startDay = bangkokInstant(bangkokDay(now), '00:00');
  const values = [];
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const { times, weekdays } = safeSchedule(schedule);
    for (let day = 0; day < days; day++) {
      const dayAt = startDay + day * DAY_MS;
      const date = bangkokDay(dayAt);
      if (date < schedule.start_date || (schedule.end_date !== null && date > schedule.end_date)
        || !weekdays.includes(new Date(dayAt + 7 * 60 * 60 * 1000).getUTCDay())) continue;
      for (const time of times) {
        const dueAt = bangkokInstant(date, time);
        // No backfill of missed medication reminders. Future occurrences stay visible.
        if (dueAt + LATE_WINDOW_MS < now) continue;
        // Stable across schedule revisions: an already-due/reported occurrence
        // must never become a second dose merely because any schedule changed.
        const material = new TextEncoder().encode(`${schedule.patient_id}\n${schedule.id}\n${date}\n${time}`);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
        const doseId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        values.push({ doseId, scheduleId: schedule.id, patientId: schedule.patient_id, version: schedule.version,
          dueAt, expiresAt: dueAt + REPORT_WINDOW_MS });
      }
    }
  }
  return values.sort((a, b) => a.dueAt - b.dueAt || a.doseId.localeCompare(b.doseId));
}

async function activeSchedules(db, patientId) {
  return rows(db.prepare(`SELECT m.* FROM medication_schedules m JOIN patients p ON p.id=m.patient_id
    JOIN care_schedules c ON c.patient_id=p.id JOIN accounts a ON a.actor_id=p.owner_actor_id
    WHERE p.id=? AND p.revoked_at IS NULL AND a.blocked_at IS NULL AND m.active=1
    AND m.version=c.current_version ORDER BY m.id LIMIT 21`).bind(patientId));
}

/** Doses and both notification intents commit together, or none do. */
export async function materializePatient(db, patientId, now) {
  if (!id(patientId) || !validNow(now)) throw Error('INVALID_SCHEDULER_INPUT');
  const schedules = await activeSchedules(db, patientId);
  const occurrences = await planOccurrences(schedules, now);
  const doseInsert = db.prepare(`INSERT INTO dose_records(patient_id,dose_id,schedule_version,due_at,expires_at,schedule_id)
    SELECT json_extract(j.value,'$.patientId'),json_extract(j.value,'$.doseId'),json_extract(j.value,'$.version'),
      json_extract(j.value,'$.dueAt'),json_extract(j.value,'$.expiresAt'),json_extract(j.value,'$.scheduleId')
    FROM json_each(?) j JOIN medication_schedules m ON m.id=json_extract(j.value,'$.scheduleId')
    JOIN patients p ON p.id=m.patient_id JOIN care_schedules c ON c.patient_id=p.id
    JOIN accounts a ON a.actor_id=p.owner_actor_id
    WHERE p.id=? AND p.id=json_extract(j.value,'$.patientId') AND p.revoked_at IS NULL
      AND a.blocked_at IS NULL AND m.active=1 AND m.version=c.current_version
      AND m.version=json_extract(j.value,'$.version')
    ON CONFLICT(patient_id,dose_id) DO UPDATE SET schedule_version=excluded.schedule_version
      WHERE dose_records.status='pending' AND dose_records.due_at>?
        AND dose_records.schedule_version<>excluded.schedule_version`).bind(JSON.stringify(occurrences), patientId, now);
  const rebindFuture = db.prepare(`UPDATE notification_outbox SET status='pending',last_code=NULL,
    schedule_version=(SELECT d.schedule_version FROM dose_records d
    WHERE d.patient_id=notification_outbox.patient_id AND d.dose_id=notification_outbox.dose_id)
    WHERE patient_id=? AND status IN ('pending','cancelled') AND attempts=0 AND available_at>?
      AND EXISTS(SELECT 1 FROM dose_records d JOIN care_schedules c ON c.patient_id=d.patient_id
        JOIN patients p ON p.id=d.patient_id JOIN medication_schedules m ON m.id=d.schedule_id AND m.patient_id=p.id
        JOIN care_members g ON g.patient_id=p.id JOIN accounts a ON a.actor_id=g.actor_id
        JOIN accounts owner ON owner.actor_id=p.owner_actor_id
        WHERE d.patient_id=notification_outbox.patient_id AND d.dose_id=notification_outbox.dose_id
          AND d.status='pending' AND d.due_at>? AND d.schedule_version=c.current_version
          AND p.revoked_at IS NULL AND owner.blocked_at IS NULL AND m.active=1 AND m.version=d.schedule_version
          AND g.actor_id=notification_outbox.recipient_actor_id AND g.revoked_at IS NULL AND a.blocked_at IS NULL
          AND ((notification_outbox.kind='reminder' AND g.role='owner' AND g.actor_id=p.owner_actor_id)
            OR (notification_outbox.kind='caregiver_alert' AND g.role='caregiver'))
          AND (notification_outbox.status='cancelled' OR d.schedule_version<>notification_outbox.schedule_version))`).bind(patientId, now, now);
  const outboxInsert = (kind, owner, delay) => db.prepare(`INSERT INTO notification_outbox
    (id,patient_id,dose_id,schedule_version,recipient_actor_id,kind,available_at,expires_at,created_at)
    SELECT ${uuidSQL},d.patient_id,d.dose_id,d.schedule_version,g.actor_id,?,d.due_at+?,d.due_at+?,?
    FROM dose_records d JOIN patients p ON p.id=d.patient_id JOIN care_schedules c ON c.patient_id=p.id
    JOIN medication_schedules m ON m.id=d.schedule_id AND m.patient_id=p.id
    JOIN care_members g ON g.patient_id=p.id JOIN accounts a ON a.actor_id=g.actor_id
    WHERE d.patient_id=? AND p.revoked_at IS NULL AND d.status='pending'
      AND c.current_version=d.schedule_version AND m.version=d.schedule_version AND m.active=1
      AND g.revoked_at IS NULL AND a.blocked_at IS NULL AND g.role=?
      AND (?=0 OR g.actor_id=p.owner_actor_id) AND d.due_at+?>=? AND d.due_at<?
    ON CONFLICT(patient_id,dose_id,recipient_actor_id,kind) DO NOTHING`)
    .bind(kind, delay, delay + LATE_WINDOW_MS, now, patientId, owner ? 'owner' : 'caregiver', owner ? 1 : 0,
      delay + LATE_WINDOW_MS, now, bangkokInstant(bangkokDay(now), '00:00') + 2 * DAY_MS);
  const results = await db.batch([doseInsert, rebindFuture, outboxInsert('reminder', true, 0), outboxInsert('caregiver_alert', false, ALERT_DELAY_MS)]);
  if (!Array.isArray(results) || results.length !== 4 || results.some(result => result?.success !== true)) throw Error('SCHEDULER_STORAGE_FAILED');
  return { dosesChanged: results[0].meta?.changes ?? 0, notificationsCreated: (results[2].meta?.changes ?? 0) + (results[3].meta?.changes ?? 0) };
}

export async function nextWake(db, patientId, now, { deliveryEnabled = true, recipients = null } = {}) {
  if (!id(patientId) || !validNow(now)) throw Error('INVALID_SCHEDULER_INPUT');
  const schedules = await activeSchedules(db, patientId);
  if (!schedules.length) return null;
  const wakeTimes = [];
  const startDay = bangkokInstant(bangkokDay(now), '00:00');
  for (const schedule of schedules) {
    const { times, weekdays } = safeSchedule(schedule);
    // At most one week from the later of today/start date is enough to find a
    // configured weekday. A far-future start does not need daily polling.
    const searchDay = Math.max(startDay, bangkokInstant(schedule.start_date, '00:00'));
    let nextDue = null;
    for (let day = 0; day < 8; day++) {
      const dayAt = searchDay + day * DAY_MS, date = bangkokDay(dayAt);
      if (schedule.end_date !== null && date > schedule.end_date) break;
      if (!weekdays.includes(new Date(dayAt + 25200000).getUTCDay())) continue;
      for (const time of times) {
        const due = bangkokInstant(date, time);
        if (due > now && (nextDue === null || due < nextDue)) nextDue = due;
      }
      if (nextDue !== null) break;
    }
    if (nextDue !== null) {
      wakeTimes.push(nextDue);
      // Populate tomorrow's upcoming rows the day before a distant occurrence.
      // This is one replenishment wake, not an unconditional midnight loop.
      const replenish = bangkokInstant(bangkokDay(nextDue), '00:00') - DAY_MS;
      if (replenish > now) wakeTimes.push(replenish);
    }
  }
  if (deliveryEnabled) {
    const pending = await rows(db.prepare(`SELECT MIN(CASE WHEN status='sending' THEN lease_until ELSE available_at END) AS wake_at
      FROM notification_outbox JOIN accounts a ON a.actor_id=notification_outbox.recipient_actor_id
      WHERE patient_id=? AND status IN ('pending','sending') AND expires_at>?
        AND (? IS NULL OR a.line_user_id IN (SELECT value FROM json_each(?)))`)
      .bind(patientId, now, recipients === null ? null : JSON.stringify(recipients), JSON.stringify(recipients ?? [])));
    if (Number.isSafeInteger(pending[0]?.wake_at)) wakeTimes.push(Math.max(now + 1000, pending[0].wake_at));
  }
  return wakeTimes.length ? Math.max(now + 1000, Math.min(...wakeTimes)) : null;
}

export async function runPatient(db, patientId, now, { env = {}, fetcher = fetch } = {}) {
  if (env.SCHEDULER_ENABLED !== 'true') return { skipped: true };
  try {
    const generated = await materializePatient(db, patientId, now);
    const delivery = await deliverPatientOutbox(db, patientId, now, env, { fetcher });
    return { ...generated, ...delivery };
  } catch { throw Error('PATIENT_SCHEDULE_FAILED'); }
}

export async function armPatient(env, patientId, { onlyIfMissing = false } = {}) {
  if (env.SCHEDULER_ENABLED !== 'true') return { skipped: true };
  if (!id(patientId) || !env.PATIENT_CLOCK?.idFromName || !env.PATIENT_CLOCK?.get) throw Error('CLOCK_NOT_CONFIGURED');
  const response = await env.PATIENT_CLOCK.get(env.PATIENT_CLOCK.idFromName(patientId)).fetch('https://clock/wake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(onlyIfMissing ? { patientId, onlyIfMissing: true } : { patientId }),
  });
  if (!response.ok) throw Error('CLOCK_ARM_FAILED');
  return { armed: true };
}

/** Bounded cyclic recovery cursor prevents the first 100 patients starving later pages. */
export async function recoverSchedules(env, now) {
  if (env.SCHEDULER_ENABLED !== 'true') return { skipped: true };
  if (!validNow(now)) throw Error('INVALID_CLOCK');
  const state = await env.DB.prepare('SELECT patient_cursor FROM scheduler_control WHERE id=1').first();
  const page = await rows(env.DB.prepare(`SELECT p.id FROM patients p WHERE p.revoked_at IS NULL
    AND p.id>? AND EXISTS(SELECT 1 FROM medication_schedules m WHERE m.patient_id=p.id AND m.active=1
      AND (m.end_date IS NULL OR m.end_date>=?))
    ORDER BY p.id LIMIT 100`).bind(state?.patient_cursor ?? '', bangkokDay(now)));
  let failed = 0;
  for (const patient of page) {
    try { await armPatient(env, patient.id, { onlyIfMissing: true }); } catch { failed++; }
  }
  // Advance even after failures; each affected object is revisited next cycle.
  checkResult(await env.DB.prepare(`UPDATE scheduler_control SET patient_cursor=?,last_recovery_at=?,
    last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,
    last_failure_at=CASE WHEN ?>0 THEN ? ELSE last_failure_at END WHERE id=1`)
    .bind(page.length === 100 ? page.at(-1).id : '', now, failed, now, failed, now).run());
  return { checked: page.length, failed };
}
