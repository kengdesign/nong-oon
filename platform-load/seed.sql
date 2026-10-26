-- Synthetic-only fresh database. Do not apply to staging or restore-review.
CREATE TABLE IF NOT EXISTS platform_load_control (
  id INTEGER PRIMARY KEY CHECK(id=1), runs INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_load_results (
  patient_id TEXT NOT NULL, cycle INTEGER NOT NULL, completed_at INTEGER NOT NULL,
  PRIMARY KEY(patient_id,cycle)
);
WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20)
INSERT OR IGNORE INTO accounts(actor_id,line_user_id,created_at)
SELECT 'U'||printf('%032x',x),'U'||printf('%032x',x),unixepoch()*1000 FROM n;
WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10)
INSERT OR IGNORE INTO patients(id,owner_actor_id,display_name,consent_version,consented_at,created_at,mutation_id)
SELECT 'bench_'||x,'U'||printf('%032x',x),'Synthetic load profile','synthetic-only',0,0,'bench_seed' FROM n;
INSERT OR IGNORE INTO care_schedules(patient_id,current_version) SELECT id,1 FROM patients;
INSERT OR IGNORE INTO care_members(patient_id,actor_id,role)
SELECT id,owner_actor_id,'owner' FROM patients;
INSERT OR IGNORE INTO care_members(patient_id,actor_id,role)
SELECT id,'U'||printf('%032x',CAST(substr(id,7) AS INTEGER)+10),'caregiver' FROM patients;
WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20)
INSERT OR IGNORE INTO medication_schedules(id,patient_id,label,instructions,times_json,weekdays_json,start_date,end_date,active,version,updated_at)
SELECT p.id||'_s_'||n.x,p.id,'Synthetic only','Not a real medication',
  '["23:50","23:51","23:52","23:53","23:54","23:55","23:56","23:57"]','[0,1,2,3,4,5,6]',
  date('now','+7 hours'),date('now','+7 hours','+1 day'),1,1,0 FROM patients p CROSS JOIN n;
-- One deployment window, never reset by a build retry.
INSERT OR IGNORE INTO platform_load_control VALUES(1,0,(unixepoch()+900)*1000);
