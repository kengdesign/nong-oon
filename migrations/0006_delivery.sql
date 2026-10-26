-- Delivery is gated separately from collection and scheduling.
ALTER TABLE dose_records ADD COLUMN schedule_id TEXT;
CREATE INDEX dose_schedule_due ON dose_records(patient_id, schedule_version, due_at);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL,
  dose_id TEXT NOT NULL,
  schedule_version INTEGER NOT NULL,
  recipient_actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reminder','caregiver_alert')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','dead','cancelled')),
  available_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER,
  lease_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  attempted_at INTEGER,
  recipient_line_id TEXT,
  payload_hash TEXT,
  sent_at INTEGER,
  last_code TEXT,
  UNIQUE(patient_id,dose_id,recipient_actor_id,kind),
  CHECK(expires_at > available_at)
);
CREATE INDEX notification_due ON notification_outbox(patient_id,status,available_at,lease_until);
CREATE INDEX notification_expiry ON notification_outbox(expires_at);
CREATE TABLE scheduler_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  patient_cursor TEXT NOT NULL DEFAULT '',
  last_recovery_at INTEGER,
  last_success_at INTEGER,
  last_failure_at INTEGER
);
INSERT INTO scheduler_control(id) VALUES(1);
-- Hard pilot caps count attempts (including timeouts), not successful responses.
CREATE TABLE delivery_budget (
  bucket TEXT PRIMARY KEY NOT NULL,
  day INTEGER NOT NULL,
  used INTEGER NOT NULL CHECK(used>=0)
);
CREATE INDEX delivery_budget_day ON delivery_budget(day);
CREATE TRIGGER notification_budget_guard BEFORE UPDATE OF attempts ON notification_outbox
WHEN NEW.attempts>OLD.attempts
BEGIN
  SELECT CASE WHEN COALESCE((SELECT used FROM delivery_budget WHERE bucket=
    CAST(CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER) AS TEXT)),0)>=100
    OR COALESCE((SELECT used FROM delivery_budget WHERE bucket=
    CAST(CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER) AS TEXT)||':'||NEW.recipient_actor_id),0)>=20
    THEN RAISE(ABORT,'DELIVERY_QUOTA') END;
END;
CREATE TRIGGER notification_budget_reserve AFTER UPDATE OF attempts ON notification_outbox
WHEN NEW.attempts>OLD.attempts
BEGIN
  INSERT INTO delivery_budget(bucket,day,used) VALUES(
    CAST(CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER) AS TEXT),
    CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER),1)
    ON CONFLICT(bucket) DO UPDATE SET used=used+1;
  INSERT INTO delivery_budget(bucket,day,used) VALUES(
    CAST(CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER) AS TEXT)||':'||NEW.recipient_actor_id,
    CAST((NEW.attempted_at+25200000)/86400000 AS INTEGER),1)
    ON CONFLICT(bucket) DO UPDATE SET used=used+1;
END;
