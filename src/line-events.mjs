// Signed minimal inbox -> account block state. Order-independent and replay safe.
// No postback may change a dose without an authenticated session + current grant.
export async function processLineEvents(db, now, limit = 50) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw Error('INVALID_PROCESSING_INPUT');
  const { results = [], success } = await db.prepare(`SELECT event_id,event_type,event_timestamp,user_id
    FROM webhook_inbox WHERE processed_at IS NULL AND expires_at>?
    ORDER BY received_at,event_id LIMIT ?`).bind(now, limit).all();
  if (!success) throw Error('INBOX_PROCESSING_FAILED');
  if (!results.length) return { processed: 0 };
  const statements = [];
  for (const row of results) {
    if (/^U[0-9a-f]{32}$/.test(row.user_id ?? '') && ['follow', 'unfollow'].includes(row.event_type)) {
      // Events may arrive before first Login. Preserve a signed block so a
      // later account/session creation cannot accidentally bypass it.
      statements.push(db.prepare(`INSERT INTO accounts(actor_id,line_user_id,blocked_at,created_at)
        VALUES(?,?,NULL,?) ON CONFLICT(actor_id) DO NOTHING`).bind(row.user_id,row.user_id,now));
      statements.push(db.prepare(`UPDATE accounts SET blocked_at=?,line_state_at=?
        WHERE line_user_id=? AND (line_state_at<? OR (line_state_at=? AND ?='unfollow'))`).bind(
        row.event_type === 'unfollow' ? now : null, row.event_timestamp, row.user_id, row.event_timestamp,
        row.event_timestamp,row.event_type));
      if (row.event_type === 'unfollow') statements.push(db.prepare(`DELETE FROM sessions WHERE actor_id IN
        (SELECT actor_id FROM accounts WHERE line_user_id=? AND blocked_at IS NOT NULL)`)
        .bind(row.user_id));
      // A newer signed follow can resume account-blocked capabilities only for
      // memberships and consents which are STILL active. It cannot undo an
      // owner revocation, rejoin an old family, or resurrect withdrawn consent.
      if (row.event_type === 'follow') statements.push(db.prepare(`INSERT INTO care_grants(patient_id,actor_id,action,revoked_at)
        SELECT m.patient_id,m.actor_id,j.value,NULL FROM care_members m
          JOIN patients p ON p.id=m.patient_id JOIN accounts a ON a.actor_id=m.actor_id
          JOIN json_each('["report_taken","report_not_taken","cancel"]') j
        WHERE a.line_user_id=? AND a.line_state_at=? AND a.blocked_at IS NULL
          AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND (j.value<>'cancel' OR m.role='owner')
        ON CONFLICT(patient_id,actor_id,action) DO UPDATE SET revoked_at=NULL`).bind(row.user_id,row.event_timestamp));
    }
    statements.push(db.prepare('UPDATE webhook_inbox SET processed_at=? WHERE event_id=? AND processed_at IS NULL')
      .bind(now, row.event_id));
  }
  const saved = await db.batch(statements);
  if (saved.some(r => r.success !== true)) throw Error('INBOX_PROCESSING_FAILED');
  return { processed: results.length };
}
