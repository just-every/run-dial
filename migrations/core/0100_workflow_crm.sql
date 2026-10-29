CREATE TABLE workflow_crm_connections (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider='hubspot'),
 operator_id TEXT NOT NULL, credential_ciphertext TEXT, version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('connected','unhealthy','revoked')), reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Canonical action type. Legacy columns remain for the prior archive upgrade;
-- a later schema contraction may remove them after released archive qualification.
ALTER TABLE workflow_rules ADD COLUMN action_type TEXT NOT NULL DEFAULT 'email-invitee'
 CHECK(action_type IN ('email-invitee','email-hosts','webhook','hubspot-contact-update'));
UPDATE workflow_rules SET action_type=COALESCE(action_kind,action);
ALTER TABLE workflow_rules ADD COLUMN crm_connection_id TEXT REFERENCES workflow_crm_connections(id) ON DELETE SET NULL;
CREATE TABLE workflow_crm_runs (
 id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, occurrence_id TEXT NOT NULL,
 workflow_version INTEGER NOT NULL, connection_id TEXT REFERENCES workflow_crm_connections(id) ON DELETE SET NULL,
 connection_version INTEGER NOT NULL, event_key TEXT NOT NULL, booking_state TEXT NOT NULL,
 properties_json TEXT NOT NULL CHECK(json_valid(properties_json)), contact_id TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','skipped','failed')),
 lease_id TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workflow_id,booking_id,event_key)
);
CREATE INDEX workflow_crm_runs_due ON workflow_crm_runs(state,created_at);

CREATE TABLE workflow_crm_erasure_requests (
 id TEXT PRIMARY KEY NOT NULL, receipt_id TEXT REFERENCES person_erasure_receipts(id),
 source_run_id TEXT NOT NULL UNIQUE, connection_id TEXT, contact_id TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT 'hubspot_properties_require_owner_cleanup',created_at TEXT NOT NULL
);
-- A per-record erasure also keeps a credential-free processor cleanup reference.
CREATE TRIGGER workflow_crm_erasure BEFORE DELETE ON workflow_crm_runs WHEN OLD.contact_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO workflow_crm_erasure_requests(id,source_run_id,connection_id,contact_id,created_at)
 VALUES(lower(hex(randomblob(16))),OLD.id,OLD.connection_id,OLD.contact_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
