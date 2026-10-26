-- LINE Login credentials/tokens are never persisted. OAuth material is short lived.
CREATE TABLE accounts (
  actor_id TEXT PRIMARY KEY NOT NULL,
  line_user_id TEXT UNIQUE NOT NULL,
  blocked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE TABLE sessions (
  session_hash TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts(actor_id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_actor ON sessions(actor_id);
-- Short-lived throttling metadata. No raw IP addresses are persisted.
CREATE TABLE auth_rate_salt (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  salt TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE auth_rate_limits (
  rate_hash TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts>=1 AND attempts<=10),
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_expiry ON auth_rate_limits(expires_at);
