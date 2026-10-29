-- Phase 2, opt-in routes only. Apply to staging only with a separate rollout.
CREATE TABLE media_consents (
  patient_id TEXT NOT NULL, actor_id TEXT NOT NULL, generation TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL, provider_id TEXT NOT NULL, granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>granted_at), revoked_at INTEGER,
  PRIMARY KEY(patient_id,actor_id)
);
CREATE TABLE media_jobs (
  id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  consent_generation TEXT NOT NULL, provider_id TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
  message_id TEXT, source_kind TEXT NOT NULL CHECK(source_kind IN ('voice','printed_label')),
  source_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>source_at),
  state TEXT NOT NULL CHECK(state IN ('queued','processing','awaiting_review','confirmed','cancelled','expired','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  lease_token TEXT, lease_until INTEGER, dispatch_at INTEGER NOT NULL DEFAULT 0,
  object_key TEXT NOT NULL UNIQUE, content_type TEXT, draft_json TEXT, last_code TEXT,
  unsent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX media_jobs_dispatch ON media_jobs(state,dispatch_at,expires_at);
CREATE INDEX media_jobs_patient ON media_jobs(patient_id,actor_id,created_at);
CREATE INDEX media_jobs_cleanup ON media_jobs(state,expires_at);
CREATE TABLE media_unsent (
  source_hash TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE media_reviews (
  job_id TEXT NOT NULL, item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 19),
  version INTEGER NOT NULL CHECK(version>=1), snapshot_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL, confirmed_at INTEGER, schedule_id TEXT,
  PRIMARY KEY(job_id,item_index)
);
CREATE TABLE media_receipts (
  confirmation_id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, item_index INTEGER NOT NULL,
  actor_id TEXT NOT NULL, patient_id TEXT NOT NULL, review_version INTEGER NOT NULL,
  base_version INTEGER NOT NULL, schedule_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(job_id,item_index)
);
CREATE TABLE media_budget (
  actor_id TEXT NOT NULL, day INTEGER NOT NULL, jobs INTEGER NOT NULL,
  PRIMARY KEY(actor_id,day)
);
CREATE TRIGGER media_job_budget BEFORE INSERT ON media_jobs
WHEN NOT EXISTS(SELECT 1 FROM media_jobs WHERE source_hash=NEW.source_hash)
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM media_jobs WHERE state IN ('queued','processing','awaiting_review'))>=50
    OR (SELECT COUNT(*) FROM media_jobs WHERE actor_id=NEW.actor_id AND state IN ('queued','processing','awaiting_review'))>=5
    OR COALESCE((SELECT jobs FROM media_budget WHERE actor_id=NEW.actor_id AND day=(NEW.created_at+25200000)/86400000),0)>=5
    OR COALESCE((SELECT SUM(jobs) FROM media_budget WHERE day=(NEW.created_at+25200000)/86400000),0)>=50
    THEN RAISE(ABORT,'MEDIA_QUOTA') END;
  INSERT INTO media_budget VALUES(NEW.actor_id,(NEW.created_at+25200000)/86400000,1)
    ON CONFLICT(actor_id,day) DO UPDATE SET jobs=jobs+1;
END;
-- Revocation/withdrawal races are guarded in writes as well as reads.
CREATE TRIGGER media_consent_invalidate AFTER UPDATE ON media_consents
WHEN NEW.revoked_at IS NOT NULL OR OLD.generation<>NEW.generation
BEGIN
  UPDATE media_jobs SET state=CASE WHEN state='confirmed' THEN state ELSE 'cancelled' END,
    draft_json=NULL,message_id=NULL,last_code='CONSENT_CHANGED'
    WHERE patient_id=OLD.patient_id AND actor_id=OLD.actor_id AND consent_generation=OLD.generation;
  DELETE FROM media_reviews WHERE job_id IN (SELECT id FROM media_jobs
    WHERE patient_id=OLD.patient_id AND actor_id=OLD.actor_id AND consent_generation=OLD.generation);
END;
CREATE TRIGGER media_patient_withdraw AFTER UPDATE OF revoked_at ON patients
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE media_consents SET revoked_at=NEW.revoked_at WHERE patient_id=NEW.id AND revoked_at IS NULL;
END;
CREATE TRIGGER media_account_block AFTER UPDATE OF blocked_at ON accounts
WHEN NEW.blocked_at IS NOT NULL
BEGIN
  UPDATE media_consents SET revoked_at=NEW.blocked_at WHERE actor_id=NEW.actor_id AND revoked_at IS NULL;
END;
CREATE TRIGGER media_member_revoke AFTER UPDATE OF revoked_at ON care_members
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE media_consents SET revoked_at=NEW.revoked_at WHERE patient_id=NEW.patient_id AND actor_id=NEW.actor_id AND revoked_at IS NULL;
END;
-- Keep random object keys as deletion manifests if existing privacy purge removes a patient.
CREATE TRIGGER media_patient_delete BEFORE DELETE ON patients
BEGIN
  UPDATE media_consents SET revoked_at=COALESCE(revoked_at,0) WHERE patient_id=OLD.id;
END;
