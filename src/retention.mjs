// Bounded maintenance primitive. No public endpoint, scheduler or retry loop.
export const MAX_PURGE_ROWS = 100;
export async function purgeExpiredInbox(db, now, limit = MAX_PURGE_ROWS) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(limit)
    || limit < 1 || limit > MAX_PURGE_ROWS) throw new Error('INVALID_PURGE_INPUT');
  if (!db || typeof db.prepare !== 'function') throw new Error('DB_NOT_READY');
  const result = await db.prepare(`DELETE FROM webhook_inbox WHERE event_id IN (
    SELECT event_id FROM webhook_inbox WHERE expires_at <= ?
    ORDER BY expires_at, event_id LIMIT ?
  )`).bind(now, limit).run();
  if (result?.success !== true || !Number.isInteger(result.meta?.changes)
    || result.meta.changes < 0 || result.meta.changes > limit) throw new Error('PURGE_FAILED');
  return { deleted: result.meta.changes };
}
