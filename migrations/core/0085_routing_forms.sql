CREATE TABLE routing_forms (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 configuration_json TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE routing_submission_tokens (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES routing_forms(id),
 token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, consumed_at TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE routing_submissions (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES routing_forms(id),
 capability_id TEXT UNIQUE REFERENCES routing_submission_tokens(id),
 form_title TEXT NOT NULL, rule_id TEXT, rule_label TEXT NOT NULL,
 answers_json TEXT NOT NULL, attribution_json TEXT NOT NULL, invitee_email TEXT,
 booking_id TEXT REFERENCES bookings(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX routing_submissions_form ON routing_submissions(form_id,created_at);
CREATE INDEX routing_submissions_booking ON routing_submissions(booking_id);
CREATE INDEX routing_submissions_email ON routing_submissions(invitee_email);
CREATE TABLE routing_handoffs (
 submission_id TEXT PRIMARY KEY REFERENCES routing_submissions(id),
 token_hash TEXT NOT NULL UNIQUE, event_type_id TEXT NOT NULL REFERENCES event_types(id),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, booking_claim_id TEXT
);
