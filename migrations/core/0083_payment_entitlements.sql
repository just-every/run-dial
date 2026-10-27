CREATE TABLE payment_products (
 id TEXT PRIMARY KEY, event_type_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('package','membership','gift')), name TEXT NOT NULL,
 sessions INTEGER NOT NULL CHECK(sessions BETWEEN 1 AND 1000),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 50 AND 99999999),
 validity_days INTEGER NOT NULL CHECK(validity_days BETWEEN 1 AND 3660),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE payment_entitlements (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES payment_products(id),
 event_type_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('package','membership','gift')),
 sessions INTEGER NOT NULL, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0), amount_cents INTEGER NOT NULL,
 purchaser_email_folded TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, purchase_key TEXT NOT NULL UNIQUE,
 checkout_session_id TEXT UNIQUE, account_id TEXT NOT NULL, subscription_id TEXT UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('pending','active','past_due','erased')),
 expires_at TEXT NOT NULL, period_start TEXT, period_end TEXT, last_event_at INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX payment_entitlement_purchaser ON payment_entitlements(purchaser_email_folded,event_type_id);
CREATE TABLE payment_redemptions (
 id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL REFERENCES payment_entitlements(id),
 booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
 units INTEGER NOT NULL CHECK(units>0), free_window_hours INTEGER, restored_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE payment_entitlement_events (
 id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL REFERENCES payment_entitlements(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
CREATE TRIGGER payment_entitlement_insert_fence BEFORE INSERT ON payment_entitlements
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.purchaser_email_folded)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER payment_entitlement_identity_fence BEFORE UPDATE OF purchaser_email_folded ON payment_entitlements
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.purchaser_email_folded)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
