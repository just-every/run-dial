-- Native people own API host partitions; the existing public calendar remains shared.
CREATE TABLE api_hosts (
 id TEXT PRIMARY KEY NOT NULL,
 operator_id TEXT UNIQUE REFERENCES oa_operators(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE api_event_hosts (
 event_type_id TEXT PRIMARY KEY NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES api_hosts(id)
);
ALTER TABLE api_oauth_applications ADD COLUMN grant_type TEXT NOT NULL DEFAULT 'client_credentials' CHECK(grant_type IN ('client_credentials','authorization_code'));
ALTER TABLE api_oauth_applications ADD COLUMN redirect_uri TEXT;
CREATE TABLE api_oauth_grants (
 id TEXT PRIMARY KEY NOT NULL,
 application_id TEXT NOT NULL REFERENCES api_oauth_applications(id),
 operator_id TEXT NOT NULL,
 scopes_json TEXT NOT NULL,
 host_id TEXT,
 team_id TEXT,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX api_oauth_grants_person ON api_oauth_grants(operator_id);
ALTER TABLE api_credentials ADD COLUMN oauth_grant_id TEXT REFERENCES api_oauth_grants(id);
CREATE TABLE api_oauth_codes (
 id TEXT PRIMARY KEY NOT NULL,
 grant_id TEXT NOT NULL REFERENCES api_oauth_grants(id),
 code_hash TEXT NOT NULL UNIQUE,
 challenge TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE api_credential_audit (
 id TEXT PRIMARY KEY NOT NULL,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
