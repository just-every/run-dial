-- Anonymous lookup keys and outcomes outlive local person deletion; no payer values or credentials.
CREATE TABLE processor_erasure_requests (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES person_erasure_receipts(id),
  kind TEXT NOT NULL CHECK(kind IN ('calendar_event_cancel','saved_card_detach','stripe_customer_anonymize','stripe_checkout_email','payment_authorization_void','payment_refund')),
  account_id TEXT NOT NULL,
  processor_ref TEXT NOT NULL,
  lookup_key TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','failed')),
  reason TEXT,
  requested INTEGER NOT NULL DEFAULT 0 CHECK(requested IN (0,1)),
  attempt_started_at TEXT,
  archive_historical INTEGER NOT NULL DEFAULT 0 CHECK(archive_historical IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(receipt_id,kind,account_id,processor_ref)
);
