-- Authenticated self-service care, explicit consent and bounded sharing.
CREATE TABLE patients (
  id TEXT PRIMARY KEY NOT NULL,
  owner_actor_id TEXT NOT NULL REFERENCES accounts(actor_id),
  display_name TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL
);
-- Re-consent creates a new identity for the care record; withdrawn history and
-- old caregiver grants cannot become visible merely by opting in again.
CREATE UNIQUE INDEX patients_active_owner ON patients(owner_actor_id) WHERE revoked_at IS NULL;
CREATE INDEX patients_owner_history ON patients(owner_actor_id,created_at);
CREATE TABLE care_members (
  patient_id TEXT NOT NULL REFERENCES patients(id),
  actor_id TEXT NOT NULL REFERENCES accounts(actor_id),
  role TEXT NOT NULL CHECK(role IN ('owner','caregiver')),
  revoked_at INTEGER,
  PRIMARY KEY(patient_id,actor_id)
);
CREATE INDEX care_members_actor ON care_members(actor_id,revoked_at,patient_id);
ALTER TABLE care_schedules ADD COLUMN mutation_id TEXT;
CREATE TABLE medication_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  label TEXT NOT NULL,
  instructions TEXT NOT NULL,
  times_json TEXT NOT NULL,
  weekdays_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  version INTEGER NOT NULL CHECK(version>=1),
  updated_at INTEGER NOT NULL
);
CREATE INDEX medication_schedules_patient ON medication_schedules(patient_id,active,version);
CREATE TABLE care_invites (
  code_hash TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  owner_actor_id TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT,
  claim_id TEXT,
  revoked_at INTEGER
);
CREATE INDEX care_invites_patient ON care_invites(patient_id,revoked_at,expires_at);
CREATE TABLE care_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT,
  version INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX care_audit_retention ON care_audit(created_at,event_id);
CREATE INDEX dose_records_retention ON dose_records(expires_at,patient_id,dose_id);
CREATE INDEX dose_audit_retention ON dose_audit(changed_at,command_id);
-- Defense in depth: an account/member revocation invalidates replay receipts too.
CREATE TRIGGER care_member_revoke AFTER UPDATE OF revoked_at ON care_members
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE care_grants SET revoked_at=NEW.revoked_at
    WHERE patient_id=NEW.patient_id AND actor_id=NEW.actor_id AND revoked_at IS NULL;
END;
CREATE TRIGGER care_account_block AFTER UPDATE OF blocked_at ON accounts
WHEN NEW.blocked_at IS NOT NULL
BEGIN
  UPDATE care_grants SET revoked_at=NEW.blocked_at
    WHERE actor_id=NEW.actor_id AND revoked_at IS NULL;
END;
CREATE TRIGGER dose_active_consent_guard BEFORE UPDATE OF status ON dose_records
WHEN OLD.status<>NEW.status
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM patients p JOIN care_members m ON m.patient_id=p.id
      JOIN accounts a ON a.actor_id=m.actor_id
    WHERE p.id=NEW.patient_id AND p.revoked_at IS NULL
      AND m.actor_id=NEW.actor_id AND m.revoked_at IS NULL AND a.blocked_at IS NULL
  ) THEN RAISE(ABORT,'CARE_ACCESS_REVOKED') END;
END;
