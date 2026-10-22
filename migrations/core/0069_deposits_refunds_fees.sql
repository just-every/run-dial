-- PAY-003: deposits, balances, refunds and cancellation or no-show fees on Stripe payments (PAY-001).
-- Additive: existing event types keep no terms, existing payments stay full payments, and existing bookings gain
-- no terms, consent or movement rows. Only Stripe customer and payment-method references are stored, never card data.

-- An event type's money terms. A cancellation policy exists only when free_window_hours is set; a fee can be
-- charged only to a card the invitee agreed to save, and a late-cancellation fee needs the free window it follows.
CREATE TABLE event_type_payment_terms (
  event_type_id TEXT PRIMARY KEY NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  deposit_kind TEXT NOT NULL DEFAULT 'none' CHECK (deposit_kind IN ('none', 'fixed', 'percent')),
  deposit_value INTEGER NOT NULL DEFAULT 0 CHECK (deposit_value >= 0 AND deposit_value <= 99999999),
  balance_due_hours INTEGER NOT NULL DEFAULT 24 CHECK (balance_due_hours >= 0 AND balance_due_hours <= 720),
  free_window_hours INTEGER CHECK (free_window_hours IS NULL OR (free_window_hours >= 1 AND free_window_hours <= 720)),
  late_cancel_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (late_cancel_fee_cents >= 0 AND late_cancel_fee_cents <= 99999999),
  no_show_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (no_show_fee_cents >= 0 AND no_show_fee_cents <= 99999999),
  terms_version INTEGER NOT NULL DEFAULT 1 CHECK (terms_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (late_cancel_fee_cents = 0 OR free_window_hours IS NOT NULL)
);

-- What the invitee was shown when the booking was held. Windows and the balance due time count back from the
-- booking's current start, so a reschedule moves them with the meeting; amounts never change.
CREATE TABLE booking_payment_terms (
  booking_id TEXT PRIMARY KEY NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  deposit_cents INTEGER NOT NULL CHECK (deposit_cents >= 0),
  due_now_cents INTEGER NOT NULL CHECK (due_now_cents >= 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  balance_due_hours INTEGER NOT NULL,
  free_window_hours INTEGER,
  late_cancel_fee_cents INTEGER NOT NULL DEFAULT 0,
  no_show_fee_cents INTEGER NOT NULL DEFAULT 0,
  terms_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- The balance link (AUTH-007): 256 random bits bound to one booking and the balance action. Dial keeps the salt it
-- derives the link from and the link's lookup hash; neither travels in an archive.
CREATE TABLE payment_link_tokens (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('balance')),
  token_salt TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (booking_id, action)
);

-- The invitee's explicit consent to a saved card for the stated fees, with the amounts and wording version they
-- saw. The Stripe customer and payment-method references are erased with the payer.
CREATE TABLE booking_card_consents (
  booking_id TEXT PRIMARY KEY NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  consent_text_version TEXT NOT NULL,
  free_window_hours INTEGER,
  late_cancel_fee_cents INTEGER NOT NULL,
  no_show_fee_cents INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  account_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every money movement after the booking's first payment: its balance, a refund or a fee. A row is never turned
-- into another movement; the client idempotency key makes a retry or a replayed event repeat nothing, and each
-- fee is attempted at most once per booking.
CREATE TABLE payment_movements (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('balance', 'refund', 'late_cancel_fee', 'no_show_fee')),
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
  updated_at TEXT NOT NULL
);
CREATE INDEX payment_movements_booking_idx ON payment_movements(booking_id, created_at);
CREATE INDEX payment_movements_pending_idx ON payment_movements(status, updated_at) WHERE status = 'pending';
CREATE UNIQUE INDEX payment_movements_fee_once_idx ON payment_movements(booking_id, kind) WHERE kind IN ('late_cancel_fee', 'no_show_fee');
CREATE UNIQUE INDEX payment_movements_balance_once_idx ON payment_movements(booking_id) WHERE kind = 'balance';

-- The first payment is the full price or a deposit.
ALTER TABLE booking_payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'deposit'));

-- An erased payer's money movements survive in the anonymized audit with their amount and Stripe reference only.
ALTER TABLE anonymized_audit ADD COLUMN amount_cents INTEGER;
ALTER TABLE anonymized_audit ADD COLUMN processor_ref TEXT;
-- A person erasure's receipt counts the saved cards Stripe detached and those it could not be asked to detach.
ALTER TABLE person_erasure_receipts ADD COLUMN saved_cards_detached INTEGER;
ALTER TABLE person_erasure_receipts ADD COLUMN saved_card_failures INTEGER;

-- A hold may now only save a card (Checkout in setup mode, nothing charged) for a free event with stated fees.
-- Holds are ephemeral and never archived; the rebuild keeps every current row and index.
ALTER TABLE payment_holds RENAME TO payment_holds_before_terms;
DROP INDEX payment_holds_active_idx;
DROP INDEX payment_holds_due_idx;
DROP INDEX payment_holds_email_idx;
CREATE TABLE payment_holds (
  id TEXT PRIMARY KEY NOT NULL,
  nonce_id TEXT NOT NULL UNIQUE,
  event_type_id TEXT NOT NULL,
  link_id TEXT,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'processing', 'confirmed', 'released', 'unbookable')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  occupied_start_at TEXT NOT NULL,
  occupied_end_at TEXT NOT NULL,
  host_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  return_token_hash TEXT NOT NULL UNIQUE,
  return_expires_at TEXT NOT NULL,
  claim_json TEXT,
  invitee_email_folded TEXT,
  booking_id TEXT,
  ended_reason TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'setup')),
  CHECK ((kind = 'payment' AND amount_cents > 0) OR (kind = 'setup' AND amount_cents = 0))
);
INSERT INTO payment_holds (id, nonce_id, event_type_id, link_id, account_id, state, start_at, end_at, occupied_start_at, occupied_end_at, host_date, amount_cents, currency, checkout_session_id, checkout_url, return_token_hash, return_expires_at, claim_json, invitee_email_folded, booking_id, ended_reason, expires_at, created_at, updated_at)
  SELECT id, nonce_id, event_type_id, link_id, account_id, state, start_at, end_at, occupied_start_at, occupied_end_at, host_date, amount_cents, currency, checkout_session_id, checkout_url, return_token_hash, return_expires_at, claim_json, invitee_email_folded, booking_id, ended_reason, expires_at, created_at, updated_at FROM payment_holds_before_terms;
DROP TABLE payment_holds_before_terms;
CREATE INDEX payment_holds_active_idx ON payment_holds(state, occupied_start_at, occupied_end_at);
CREATE INDEX payment_holds_due_idx ON payment_holds(state, expires_at);
CREATE INDEX payment_holds_email_idx ON payment_holds(invitee_email_folded);
