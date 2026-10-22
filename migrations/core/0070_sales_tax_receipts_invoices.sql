-- PAY-005: Stripe Tax, receipts and invoices on Stripe payments (PAY-001, PAY-003).
-- Additive: tax stays off, existing payments and movements carry no tax, and every existing row is kept.
-- Dial stores only tax amounts and the jurisdiction summary Stripe Tax returns, never an address or a card.

-- The deployment's payment settings: Stripe Tax on or off, and the business name receipts and invoices carry
-- (the host's profile name when unset).
CREATE TABLE payment_settings (
  singleton_key TEXT PRIMARY KEY NOT NULL DEFAULT 'default' CHECK (singleton_key = 'default'),
  tax_enabled INTEGER NOT NULL DEFAULT 0 CHECK (tax_enabled IN (0, 1)),
  business_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The first payment's share of the sales tax, and the tax on the whole price a booking was shown.
ALTER TABLE booking_payments ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0);
ALTER TABLE booking_payments ADD COLUMN tax_summary TEXT;
ALTER TABLE booking_payment_terms ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0);
ALTER TABLE booking_payment_terms ADD COLUMN tax_summary TEXT;

-- Movements gain the invoice kind (a host-issued invoice paid on Stripe's hosted page) and each movement's tax:
-- the tax a balance or invoice charged, or a refund's proportional share. The rebuild keeps every row and index.
ALTER TABLE payment_movements RENAME TO payment_movements_before_tax;
DROP INDEX payment_movements_booking_idx;
DROP INDEX payment_movements_pending_idx;
DROP INDEX payment_movements_fee_once_idx;
DROP INDEX payment_movements_balance_once_idx;
CREATE TABLE payment_movements (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('balance', 'invoice', 'refund', 'late_cancel_fee', 'no_show_fee')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('invitee', 'operator', 'policy')),
  actor_id TEXT,
  reason TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_ref TEXT,
  processor_ref TEXT,
  checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  checkout_attempt INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tax_summary TEXT,
  invoice_id TEXT UNIQUE,
  invoice_number TEXT,
  invoice_url TEXT
);
INSERT INTO payment_movements (id, booking_id, kind, amount_cents, currency, status, actor_type, actor_id, reason, account_id, source_ref, processor_ref, checkout_session_id, checkout_url, checkout_attempt, failure_code, idempotency_key, created_at, updated_at)
  SELECT id, booking_id, kind, amount_cents, currency, status, actor_type, actor_id, reason, account_id, source_ref, processor_ref, checkout_session_id, checkout_url, checkout_attempt, failure_code, idempotency_key, created_at, updated_at FROM payment_movements_before_tax;
DROP TABLE payment_movements_before_tax;
CREATE INDEX payment_movements_booking_idx ON payment_movements(booking_id, created_at);
CREATE INDEX payment_movements_pending_idx ON payment_movements(status, updated_at) WHERE status = 'pending';
CREATE UNIQUE INDEX payment_movements_fee_once_idx ON payment_movements(booking_id, kind) WHERE kind IN ('late_cancel_fee', 'no_show_fee');
CREATE UNIQUE INDEX payment_movements_balance_once_idx ON payment_movements(booking_id) WHERE kind = 'balance';
CREATE UNIQUE INDEX payment_movements_invoice_once_idx ON payment_movements(booking_id) WHERE kind = 'invoice';
