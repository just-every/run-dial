CREATE TABLE payment_processor_facts (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('charge','refund','fee','dispute','payout')),
 processor_ref TEXT NOT NULL, source_ref TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 status TEXT NOT NULL, disagreement INTEGER NOT NULL DEFAULT 0, resolved_at TEXT, resolved_by TEXT, event_created INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(account_id,kind,processor_ref,booking_id)
);
CREATE INDEX payment_processor_facts_booking ON payment_processor_facts(booking_id);
CREATE TABLE accounting_connections (
 id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, status TEXT NOT NULL,
 access_token_ciphertext TEXT, refresh_token_ciphertext TEXT, expires_at TEXT,
 income_account_id TEXT, item_id TEXT, reason TEXT, refresh_started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE accounting_oauth_states (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, operator_id TEXT NOT NULL,
 expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE accounting_exports (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL, payment_ref TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 request_id TEXT NOT NULL UNIQUE, document_ref TEXT NOT NULL, payload_json TEXT NOT NULL, receipt_id TEXT, state TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(connection_id,payment_ref)
);
