export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 30_000;
export const MAX_DELIVERIES_PER_WAKE = 10;
const MAX_KEY_AGE_MS = 23 * 60 * 60 * 1000;
const lineId = value => typeof value === 'string' && /^U[0-9a-f]{32}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validNow = value => Number.isSafeInteger(value) && value >= 0;
const ok = result => { if (result?.success !== true) throw Error('OUTBOX_STORAGE_FAILED'); return result; };
const all = async statement => { const result = ok(await statement.all()); if (!Array.isArray(result.results)) throw Error('OUTBOX_STORAGE_FAILED'); return result.results; };

export function deliveryConfig(env) {
  if (env.DELIVERY_ENABLED !== 'true' || env.SCHEDULER_ENABLED !== 'true') return null;
  let recipients, origin;
  try { recipients = JSON.parse(env.LIVE_LINE_RECIPIENTS); origin = new URL(env.APP_ORIGIN); } catch { return null; }
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10 || recipients.some(value => !lineId(value))
    || origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || origin.username || origin.password
    || typeof env.LINE_CHANNEL_ACCESS_TOKEN !== 'string' || !env.LINE_CHANNEL_ACCESS_TOKEN.trim()) return null;
  return { recipients, origin: origin.origin, token: env.LINE_CHANNEL_ACCESS_TOKEN };
}

/** Generic lock-screen content; medication, patient and account data stay behind login. */
export function notificationText(kind, origin) {
  const lead = kind === 'reminder'
    ? 'น้องอุ่น: ถึงเวลาตามตารางที่คุณตั้งไว้แล้ว เปิดดูรายละเอียดและบันทึกสถานะในระบบ'
    : 'น้องอุ่น: ยังไม่ได้รับการบันทึกสถานะตามเวลาที่ตั้งไว้ เปิดตรวจสอบและติดต่อคนที่คุณดูแลได้ตามความเหมาะสม ข้อความนี้ไม่ได้บ่งชี้ภาวะฉุกเฉิน';
  return `${lead}\n${origin}/`;
}

/** Adapter deliberately takes a persisted retry key on the first and every attempt. */
export async function sendLineNotification({ to, retryKey, text }, { token, fetcher = fetch } = {}) {
  if (!lineId(to) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(retryKey)
    || typeof text !== 'string' || text.length > 1000 || typeof token !== 'string' || !token.trim()) throw Error('INVALID_DELIVERY');
  let response;
  try {
    response = await fetcher('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-line-retry-key': retryKey },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }), signal: AbortSignal.timeout(10_000), redirect: 'manual',
    });
  } catch { return { accepted: false, retryable: true, code: 'NETWORK' }; }
  // We never retain/log response bodies or private request identifiers.
  try { await response.body?.cancel(); } catch { /* no response details required */ }
  if (response.status >= 200 && response.status < 300) return { accepted: true, retryable: false, code: 'ACCEPTED' };
  if (response.status === 409 && response.headers.has('x-line-accepted-request-id')) return { accepted: true, retryable: false, code: 'ALREADY_ACCEPTED' };
  if (response.status >= 500 && response.status <= 599) return { accepted: false, retryable: true, code: 'UPSTREAM' };
  // 429 is intentionally not retried: a pilot must not churn against plan/rate caps.
  return { accepted: false, retryable: false, code: response.status === 429 ? 'QUOTA' : 'REJECTED' };
}

// All mutable permission checks are repeated in the atomic lease write and in
// the final read immediately before HTTP. No database can retract an HTTP call
// already accepted by LINE; withdrawal prevents the next claim/network attempt.
const eligible = `EXISTS(SELECT 1 FROM patients p JOIN care_schedules c ON c.patient_id=p.id
  JOIN dose_records d ON d.patient_id=p.id JOIN medication_schedules m ON m.id=d.schedule_id AND m.patient_id=p.id
  JOIN care_members g ON g.patient_id=p.id JOIN accounts a ON a.actor_id=g.actor_id
  JOIN accounts owner ON owner.actor_id=p.owner_actor_id
  WHERE p.id=notification_outbox.patient_id AND p.revoked_at IS NULL AND owner.blocked_at IS NULL
    AND d.dose_id=notification_outbox.dose_id AND d.status='pending' AND d.expires_at>?
    AND d.schedule_version=notification_outbox.schedule_version AND c.current_version=d.schedule_version
    AND m.version=d.schedule_version AND m.active=1 AND g.actor_id=notification_outbox.recipient_actor_id
    AND g.revoked_at IS NULL AND a.blocked_at IS NULL
    AND ((notification_outbox.kind='reminder' AND g.role='owner' AND g.actor_id=p.owner_actor_id)
      OR (notification_outbox.kind='caregiver_alert' AND g.role='caregiver')))`;

export async function deliverPatientOutbox(db, patientId, now, env, { fetcher = fetch, clock = Date.now } = {}) {
  if (!id(patientId) || !validNow(now)) throw Error('INVALID_DELIVERY_INPUT');
  const config = deliveryConfig(env);
  if (!config) return { sent: 0, retried: 0, dead: 0, deliverySkipped: true };
  // Terminalize expired, stale, revoked and exhausted rows before selecting work.
  ok(await db.prepare(`UPDATE notification_outbox SET status=CASE WHEN expires_at<=? OR attempts>=? THEN 'dead' ELSE 'cancelled' END,
    lease_token=NULL,lease_until=NULL,last_code=CASE WHEN expires_at<=? THEN 'LATE' WHEN attempts>=? THEN 'EXHAUSTED' ELSE 'INELIGIBLE' END
    WHERE patient_id=? AND status IN ('pending','sending') AND (status='pending' OR lease_until<=?)
    AND (expires_at<=? OR attempts>=? OR NOT ${eligible})`)
    .bind(now, MAX_ATTEMPTS, now, MAX_ATTEMPTS, patientId, now, now, MAX_ATTEMPTS, now).run());
  const candidates = await all(db.prepare(`SELECT o.*,a.line_user_id FROM notification_outbox o
    JOIN accounts a ON a.actor_id=o.recipient_actor_id
    WHERE o.patient_id=? AND ((o.status='pending' AND o.available_at<=?) OR (o.status='sending' AND o.lease_until<=?))
      AND o.expires_at>? AND a.line_user_id IN (SELECT value FROM json_each(?))
      ORDER BY o.available_at,o.id LIMIT ?`).bind(patientId, now, now, now, JSON.stringify(config.recipients), MAX_DELIVERIES_PER_WAKE));
  const metrics = { sent: 0, retried: 0, dead: 0, quotaLimited: false };
  for (const job of candidates) {
    const attemptNow = Math.max(now, clock());
    if (!validNow(attemptNow)) throw Error('INVALID_CLOCK');
    if (!config.recipients.includes(job.line_user_id)) continue;
    const text = notificationText(job.kind, config.origin);
    const payload = JSON.stringify({ to: job.line_user_id, messages: [{ type: 'text', text }] });
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if ((job.payload_hash !== null && job.payload_hash !== hash)
      || (job.recipient_line_id !== null && job.recipient_line_id !== job.line_user_id)
      || (job.first_attempt_at !== null && attemptNow - job.first_attempt_at >= MAX_KEY_AGE_MS)) {
      ok(await db.prepare(`UPDATE notification_outbox SET status='dead',last_code='PAYLOAD_OR_KEY_CHANGED',lease_token=NULL,lease_until=NULL
        WHERE id=? AND (status='pending' OR (status='sending' AND lease_until<=?))`).bind(job.id, attemptNow).run());
      metrics.dead++; continue;
    }
    const lease = crypto.randomUUID();
    let claim;
    try {
      claim = ok(await db.prepare(`UPDATE notification_outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,
        first_attempt_at=COALESCE(first_attempt_at,?),attempted_at=?,recipient_line_id=?,payload_hash=?
        WHERE id=? AND patient_id=? AND attempts<? AND expires_at>?
        AND ((status='pending' AND available_at<=?) OR (status='sending' AND lease_until<=?))
        AND ${eligible} RETURNING id`).bind(lease, attemptNow + LEASE_MS, attemptNow, attemptNow, job.line_user_id, hash, job.id, patientId,
        MAX_ATTEMPTS, attemptNow, attemptNow, attemptNow, attemptNow).all());
    } catch (error) {
      if (String(error?.message).includes('DELIVERY_QUOTA')) {
        ok(await db.prepare(`UPDATE notification_outbox SET status='dead',last_code='QUOTA',lease_until=NULL,lease_token=NULL
          WHERE id=? AND (status='pending' OR (status='sending' AND lease_until<=?))`).bind(job.id, attemptNow).run());
        metrics.quotaLimited = true; metrics.dead++; continue;
      }
      throw Error('OUTBOX_CLAIM_FAILED');
    }
    // D1 meta.changes includes budget-trigger writes; only RETURNING proves lease ownership.
    if (!Array.isArray(claim.results) || claim.results.length !== 1 || claim.results[0].id !== job.id) continue;
    // Avoid a stale read from a replica: all app DB operations use primary binding.
    const current = await db.prepare(`SELECT id FROM notification_outbox WHERE id=? AND status='sending' AND lease_token=?
      AND expires_at>? AND ${eligible}`).bind(job.id, lease, Math.max(attemptNow, clock()), Math.max(attemptNow, clock())).first();
    if (!current) {
      ok(await db.prepare(`UPDATE notification_outbox SET status='cancelled',last_code='INELIGIBLE',lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=?`).bind(job.id, lease).run());
      continue;
    }
    const outcome = await sendLineNotification({ to: job.line_user_id, retryKey: job.id, text }, { token: config.token, fetcher });
    const attempts = job.attempts + 1;
    const finishedAt = Math.max(attemptNow, clock());
    const retryAt = finishedAt + Math.min(5 * 60_000, 15_000 * 2 ** (attempts - 1));
    const terminal = !outcome.accepted && (!outcome.retryable || attempts >= MAX_ATTEMPTS || retryAt >= job.expires_at);
    const status = outcome.accepted ? 'sent' : terminal ? 'dead' : 'pending';
    ok(await db.prepare(`UPDATE notification_outbox SET status=?,sent_at=?,available_at=?,last_code=?,lease_token=NULL,lease_until=NULL
      WHERE id=? AND status='sending' AND lease_token=?`).bind(status, outcome.accepted ? finishedAt : null,
      status === 'pending' ? retryAt : job.available_at, outcome.code, job.id, lease).run());
    if (outcome.accepted) metrics.sent++; else if (terminal) metrics.dead++; else metrics.retried++;
  }
  return metrics;
}
