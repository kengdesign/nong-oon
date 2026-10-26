-- Only minimal LINE account-state events are processed. No message bodies/tokens.
ALTER TABLE accounts ADD COLUMN line_state_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_inbox ADD COLUMN processed_at INTEGER;
CREATE INDEX webhook_inbox_processing ON webhook_inbox(processed_at,received_at,event_id);
CREATE INDEX patients_revoked ON patients(revoked_at,id);
CREATE TABLE operation_health (
  task TEXT PRIMARY KEY NOT NULL,
  last_ok_at INTEGER NOT NULL,
  rows_processed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE api_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX api_rate_limits_expiry ON api_rate_limits(expires_at);
