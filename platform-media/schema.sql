CREATE TABLE IF NOT EXISTS drill_jobs(id TEXT PRIMARY KEY CHECK(id='synthetic-v1'),state TEXT NOT NULL,dispatches INTEGER NOT NULL DEFAULT 0,delete_started INTEGER NOT NULL DEFAULT 0,completed_at INTEGER);
CREATE TABLE IF NOT EXISTS drill_ai(kind TEXT PRIMARY KEY CHECK(kind IN ('voice','image')),state TEXT NOT NULL);
