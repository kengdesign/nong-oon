-- Staging inbox. Expiry is metadata, NOT automatic deletion: a retention worker
-- and privacy review are required before enabling real-user ingestion.
-- No message text, media, raw payloads, reply tokens or channel secrets are stored.
CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  user_id TEXT,
  postback_data TEXT,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (event_timestamp >= 0 AND expires_at > received_at)
);
CREATE INDEX IF NOT EXISTS webhook_inbox_expiry ON webhook_inbox(expires_at);
