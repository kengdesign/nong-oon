-- Service administration is independent of patient ownership and care grants.
CREATE TABLE service_admins (
  actor_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(actor_id),
  granted_by TEXT NOT NULL REFERENCES accounts(actor_id),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES accounts(actor_id)
);
CREATE TABLE service_admin_invites (
  code_hash TEXT PRIMARY KEY NOT NULL,
  target_actor_id TEXT NOT NULL REFERENCES accounts(actor_id),
  issued_by TEXT NOT NULL REFERENCES accounts(actor_id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  claim_id TEXT UNIQUE
);
CREATE INDEX service_admin_invites_expiry ON service_admin_invites(expires_at);
CREATE TABLE service_admin_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX service_admin_audit_time ON service_admin_audit(created_at);
CREATE TRIGGER service_admin_invited AFTER INSERT ON service_admin_invites BEGIN
  INSERT INTO service_admin_audit VALUES(lower(hex(randomblob(16))),'invite_created',NEW.issued_by,NEW.target_actor_id,NEW.created_at);
END;
CREATE TRIGGER service_admin_invite_revoked AFTER UPDATE OF revoked_at ON service_admin_invites
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
  INSERT INTO service_admin_audit VALUES(lower(hex(randomblob(16))),'invite_revoked',NEW.issued_by,NEW.target_actor_id,NEW.revoked_at);
END;
CREATE TRIGGER service_admin_granted AFTER INSERT ON service_admins BEGIN
  INSERT INTO service_admin_audit VALUES(lower(hex(randomblob(16))),'admin_granted',NEW.granted_by,NEW.actor_id,NEW.granted_at);
END;
CREATE TRIGGER service_admin_changed AFTER UPDATE ON service_admins
WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL) BEGIN
  INSERT INTO service_admin_audit VALUES(lower(hex(randomblob(16))),
    CASE WHEN NEW.revoked_at IS NULL THEN 'admin_granted' ELSE 'admin_revoked' END,
    CASE WHEN NEW.revoked_at IS NULL THEN NEW.granted_by ELSE NEW.revoked_by END,
    NEW.actor_id,COALESCE(NEW.revoked_at,NEW.granted_at));
END;
