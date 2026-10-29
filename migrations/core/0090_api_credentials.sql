CREATE TABLE api_oauth_applications (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL DEFAULT 'default',
 host_id TEXT,
 team_id TEXT,
 scopes_json TEXT NOT NULL,
 client_secret_hash TEXT UNIQUE,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK (host_id IS NULL OR team_id IS NULL)
);
CREATE INDEX api_oauth_applications_owner ON api_oauth_applications(operator_id);

CREATE TABLE api_credentials (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL DEFAULT 'default',
 host_id TEXT,
 team_id TEXT,
 scopes_json TEXT NOT NULL,
 secret_hash TEXT UNIQUE,
 expires_at TEXT NOT NULL,
 last_used_at TEXT,
 revoked_at TEXT,
 oauth_application_id TEXT REFERENCES api_oauth_applications(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK (host_id IS NULL OR team_id IS NULL)
);
CREATE INDEX api_credentials_owner ON api_credentials(operator_id);
