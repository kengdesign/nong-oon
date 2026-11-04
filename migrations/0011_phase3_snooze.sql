CREATE TABLE notification_outbox_phase3 (
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
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  UNIQUE(patient_id,dose_id,recipient_actor_id,kind,generation),
  CHECK(expires_at > available_at)
);

INSERT INTO notification_outbox_phase3 (id,patient_id,dose_id,schedule_version,recipient_actor_id,kind,status,available_at,expires_at,lease_until,lease_token,attempts,created_at,first_attempt_at,attempted_at,recipient_line_id,payload_hash,sent_at,last_code) SELECT id,patient_id,dose_id,schedule_version,recipient_actor_id,kind,status,available_at,expires_at,lease_until,lease_token,attempts,created_at,first_attempt_at,attempted_at,recipient_line_id,payload_hash,sent_at,last_code FROM notification_outbox;
DROP TABLE notification_outbox;
ALTER TABLE notification_outbox_phase3 RENAME TO notification_outbox;
CREATE INDEX notification_due ON notification_outbox(patient_id,status,available_at,lease_until);
CREATE INDEX notification_expiry ON notification_outbox(expires_at);
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
