-- Match retention filtering and deterministic ordering without a temporary sort.
-- Additive migration; existing data and the original index are preserved.
CREATE INDEX IF NOT EXISTS webhook_inbox_expiry_event ON webhook_inbox(expires_at, event_id);
