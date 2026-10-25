-- Foundation only: no API route, provisioning or real-user ingestion is enabled.
CREATE TABLE care_grants (
  patient_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('report_taken','report_not_taken','cancel')),
  revoked_at INTEGER,
  PRIMARY KEY(patient_id, actor_id, action)
);
CREATE TABLE care_schedules (
  patient_id TEXT PRIMARY KEY NOT NULL,
  current_version INTEGER NOT NULL CHECK(current_version >= 1)
);
CREATE TABLE dose_records (
  patient_id TEXT NOT NULL, dose_id TEXT NOT NULL,
  schedule_version INTEGER NOT NULL CHECK(schedule_version >= 1),
  due_at INTEGER NOT NULL CHECK(due_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > due_at),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reported_taken','reported_not_taken','cancelled')),
  command_id TEXT UNIQUE, actor_id TEXT, changed_at INTEGER,
  PRIMARY KEY(patient_id, dose_id),
  CHECK((status = 'pending' AND command_id IS NULL AND actor_id IS NULL AND changed_at IS NULL)
    OR (status <> 'pending' AND command_id IS NOT NULL AND actor_id IS NOT NULL AND changed_at IS NOT NULL))
);
CREATE TABLE dose_audit (
  command_id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL, dose_id TEXT NOT NULL,
  schedule_version INTEGER NOT NULL, actor_id TEXT NOT NULL,
  status TEXT NOT NULL, changed_at INTEGER NOT NULL
);
-- A failed audit INSERT rolls back the status UPDATE too.
CREATE TRIGGER dose_status_audit AFTER UPDATE OF status ON dose_records
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO dose_audit VALUES(NEW.command_id,NEW.patient_id,NEW.dose_id,
    NEW.schedule_version,NEW.actor_id,NEW.status,NEW.changed_at);
END;
