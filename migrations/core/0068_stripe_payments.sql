-- PAY-001: paid bookings with Stripe Checkout through the host's own Stripe Connect Standard account.
-- Additive only: existing event types stay free and existing bookings carry no payment.

-- One connected Stripe account per installation (single-host Dial). Only the connected account ID is
-- stored: no access or refresh token, and never a card number or payer detail.
CREATE TABLE payment_connections (
  singleton_key TEXT PRIMARY KEY NOT NULL DEFAULT 'default' CHECK (singleton_key = 'default'),
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'deauthorized', 'disconnected')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0, 1)),
  ach_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ach_enabled IN (0, 1)),
  connected_by_operator_id TEXT,
  connected_at TEXT,
  status_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Session-bound Connect OAuth state (AUTH-004 rules): single use, ten-minute lifetime.
CREATE TABLE payment_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX payment_oauth_states_expiry_idx ON payment_oauth_states(expires_at, consumed_at);

-- USD prices in cents. duration_minutes 0 is the event's price for every offered duration; a row for an
-- offered duration (EVENT-011) overrides it for that duration.
CREATE TABLE event_type_prices (
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0 AND duration_minutes <= 480),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 50 AND amount_cents <= 99999999),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_type_id, duration_minutes)
);

-- A slot held for one payer during the payment window. An active hold (held or processing) blocks the slot
-- exactly like a confirmed booking (BOOK-002). The pending booking claim and the payer's folded email exist
-- only while the hold is active and are cleared when it confirms or is released.
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
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
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
  updated_at TEXT NOT NULL
);
CREATE INDEX payment_holds_active_idx ON payment_holds(state, occupied_start_at, occupied_end_at);
CREATE INDEX payment_holds_due_idx ON payment_holds(state, expires_at);
CREATE INDEX payment_holds_email_idx ON payment_holds(invitee_email_folded);

-- The payment a confirmed booking carries. Cancel and reschedule keep it (refunds are PAY-003).
CREATE TABLE booking_payments (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  account_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  checkout_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status = 'paid'),
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Stripe's signed webhook (AUTH-005) is admitted under its own provider rate limit. Admission rows are
-- ephemeral and never archived; the rebuild keeps every current row and index.
ALTER TABLE public_rate_events RENAME TO public_rate_events_before_stripe;
CREATE TABLE public_rate_events (
  id TEXT PRIMARY KEY NOT NULL,
  client_key TEXT NOT NULL,
  booking_mutation INTEGER NOT NULL CHECK (booking_mutation IN (0, 1)),
  alternative_submission INTEGER NOT NULL CHECK (alternative_submission IN (0, 1)),
  provider TEXT CHECK (provider IN ('google_calendar', 'resend', 'sendgrid', 'stripe')),
  admitted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO public_rate_events SELECT * FROM public_rate_events_before_stripe;
DROP TABLE public_rate_events_before_stripe;
CREATE INDEX public_rate_client_time ON public_rate_events(client_key, admitted_at);
CREATE INDEX public_rate_booking_time ON public_rate_events(client_key, admitted_at) WHERE booking_mutation = 1;
CREATE INDEX public_rate_request_time ON public_rate_events(client_key, admitted_at) WHERE alternative_submission = 1;
CREATE INDEX public_rate_provider_time ON public_rate_events(provider, admitted_at) WHERE provider IS NOT NULL;
CREATE INDEX public_rate_expiry ON public_rate_events(expires_at);
