CREATE TABLE emergency_contacts (
 patient_id TEXT NOT NULL REFERENCES patients(id),
 priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3),
 name TEXT NOT NULL, phone TEXT NOT NULL,
 PRIMARY KEY(patient_id,priority)
);
CREATE TRIGGER emergency_contact_withdraw AFTER UPDATE OF revoked_at ON patients
WHEN NEW.revoked_at IS NOT NULL BEGIN
 DELETE FROM emergency_contacts WHERE patient_id=NEW.id;
END;

CREATE TABLE voice_command_consents (
 patient_id TEXT NOT NULL,actor_id TEXT NOT NULL,granted_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(patient_id,actor_id)
);
CREATE TRIGGER voice_command_withdraw AFTER UPDATE OF revoked_at ON patients
WHEN NEW.revoked_at IS NOT NULL BEGIN
 DELETE FROM voice_command_consents WHERE patient_id=NEW.id;
END;
CREATE TRIGGER voice_command_media_revoke AFTER UPDATE OF revoked_at ON media_consents
WHEN NEW.revoked_at IS NOT NULL BEGIN
 DELETE FROM voice_command_consents WHERE patient_id=NEW.patient_id AND actor_id=NEW.actor_id;
END;
