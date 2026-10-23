CREATE TABLE workspace_notice_destinations (
 id TEXT PRIMARY KEY CHECK(id IN ('slack','teams')), generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('connected','failed','disconnected','needs_reconnect')),
 credential_ciphertext TEXT, target TEXT NOT NULL, external_key TEXT NOT NULL,
 masked_tail TEXT NOT NULL, reason TEXT, cooldown_until TEXT, active_delivery_id TEXT,
 alerted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE notice_oauth_states (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, operator_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('channel','dm')), target TEXT NOT NULL,
 expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE workspace_notice_deliveries (
 id TEXT PRIMARY KEY, destination_id TEXT NOT NULL REFERENCES workspace_notice_destinations(id),
 generation INTEGER NOT NULL, account_id TEXT NOT NULL, channel_id TEXT NOT NULL, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
 event_kind TEXT NOT NULL CHECK(event_kind IN ('created','rescheduled','cancelled')),
 idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('pending','invoking','succeeded','failed','outcome_unknown')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, first_attempt_at TEXT,
 provider_ref TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX workspace_notice_due ON workspace_notice_deliveries(state,next_attempt_at);
CREATE TABLE notice_erasure_requests (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES person_erasure_receipts(id),
 provider TEXT NOT NULL CHECK(provider IN ('slack','teams')), source_delivery_id TEXT NOT NULL,
 account_id TEXT NOT NULL, channel_id TEXT NOT NULL, processor_ref TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','completed','failed')), reason TEXT,
 requested INTEGER NOT NULL DEFAULT 0, archive_historical INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(receipt_id,source_delivery_id)
);
