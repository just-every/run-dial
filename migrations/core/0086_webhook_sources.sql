CREATE TABLE teams (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, host_id TEXT NOT NULL REFERENCES host_profiles(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE team_event_types (
 team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(team_id,event_type_id)
);
CREATE TABLE routing_forms (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, host_id TEXT NOT NULL REFERENCES host_profiles(id),
 config_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE routing_submissions (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES routing_forms(id),
 event_type_id TEXT REFERENCES event_types(id), team_id TEXT REFERENCES teams(id),
 host_id TEXT NOT NULL REFERENCES host_profiles(id), rule_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('matched','disqualified')),
 result_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX routing_submissions_form_idx ON routing_submissions(form_id,created_at);
CREATE TABLE routing_capabilities (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES routing_forms(id) ON DELETE CASCADE,
 nonce_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, consumed_at TEXT,
 submission_id TEXT REFERENCES routing_submissions(id), payload_hash TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX routing_capabilities_expiry_idx ON routing_capabilities(expires_at);
