// Inbox only: no medication action or outbound delivery is executed here.
export const MAX_EVENTS = 20;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
export function projectEvents(events, now) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS || !Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_EVENTS');
  return events.map(event => {
    if (!event || !bounded(event.webhookEventId, 128) || !/^[A-Za-z0-9_-]+$/.test(event.webhookEventId)
      || !bounded(event.type, 64) || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.type)
      || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) throw new Error('INVALID_EVENTS');
    const userId = event.source?.userId;
    if (userId !== undefined && (!bounded(userId, 128) || !/^[A-Za-z0-9_-]+$/.test(userId))) throw new Error('INVALID_EVENTS');
    const data = event.type === 'postback' ? event.postback?.data : undefined;
    if (event.type === 'postback' && (!bounded(data, 256) || /[\u0000-\u001f]/.test(data))) throw new Error('INVALID_EVENTS');
    return { eventId: event.webhookEventId, type: event.type, timestamp: event.timestamp,
      userId: userId ?? null, postbackData: data ?? null, receivedAt: now, expiresAt: now + RETENTION_MS };
  });
}
export async function persistEvents(db, rows) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new Error('DB_NOT_READY');
  if (rows.length === 0) return;
  const statements = rows.map(row => db.prepare(`INSERT INTO webhook_inbox
    (event_id, event_type, event_timestamp, user_id, postback_data, received_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
    .bind(row.eventId, row.type, row.timestamp, row.userId, row.postbackData, row.receivedAt, row.expiresAt));
  // D1 batch is transactional. A failed batch must never be acknowledged.
  const results = await db.batch(statements);
  if (!Array.isArray(results) || results.length !== rows.length || results.some(result => result?.success !== true)) throw new Error('DB_WRITE_FAILED');
}
