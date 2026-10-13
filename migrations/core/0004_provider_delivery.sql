-- Provider credentials, the privacy-minimal calendar cache, and durable delivery
-- commands. This migration deliberately has no dependency on booking tables added
-- later: booking and request IDs are opaque correlation identifiers here.

CREATE TABLE calendar_connections (
  singleton_key TEXT PRIMARY KEY NOT NULL CHECK (singleton_key = 'default'),
  provider TEXT NOT NULL CHECK (provider = 'google'),
  status TEXT NOT NULL CHECK (status IN ('disconnected', 'healthy', 'unhealthy')),
  authorised_by_operator_id TEXT,
  account_email TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TEXT,
  sync_cursor TEXT,
  channel_id TEXT,
  channel_resource_id TEXT,
  channel_expires_at TEXT,
  last_checked_at TEXT,
  last_successful_read_at TEXT,
  unhealthy_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_connection_calendars (
  id TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('destination', 'conflict')),
  conference_capable INTEGER NOT NULL DEFAULT 0 CHECK (conference_capable IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(calendar_id, purpose)
);

CREATE UNIQUE INDEX calendar_connection_single_destination_idx
  ON calendar_connection_calendars(purpose) WHERE purpose = 'destination';

CREATE TABLE calendar_push_channels (
  id TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  provider_channel_id TEXT NOT NULL UNIQUE,
  provider_resource_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(calendar_id)
);

CREATE INDEX calendar_push_channels_expiry_idx
  ON calendar_push_channels(expires_at);

CREATE TABLE provider_connection_health (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('google_calendar', 'resend')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  last_checked_at TEXT,
  unhealthy_code TEXT,
  alert_state TEXT NOT NULL CHECK (alert_state IN ('healthy_announced', 'unhealthy_announced', 'unannounced')),
  alert_cycle INTEGER NOT NULL DEFAULT 0 CHECK (alert_cycle >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX calendar_oauth_states_expiry_idx
  ON calendar_oauth_states(expires_at, consumed_at);

-- Only conflict information is retained. Provider event contents never enter D1.
CREATE TABLE calendar_busy_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  transparency TEXT NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'transparent')),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(calendar_id, starts_at, ends_at)
);

CREATE INDEX calendar_busy_intervals_lookup_idx
  ON calendar_busy_intervals(calendar_id, starts_at, ends_at, observed_at);

CREATE TABLE calendar_busy_read_windows (
  id TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX calendar_busy_read_windows_coverage_idx
  ON calendar_busy_read_windows(calendar_id, starts_at, ends_at, observed_at);

CREATE TABLE delivery_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('calendar_upsert', 'calendar_cancel', 'mail_send', 'reminder')),
  idempotency_key TEXT NOT NULL UNIQUE,
  booking_id TEXT,
  occurrence_id TEXT,
  request_id TEXT,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  succeeded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX delivery_outbox_due_idx
  ON delivery_outbox(state, next_attempt_at, created_at);

CREATE INDEX delivery_outbox_booking_idx
  ON delivery_outbox(booking_id, occurrence_id, state);

CREATE INDEX delivery_outbox_request_idx
  ON delivery_outbox(request_id, state);

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  outbox_id TEXT NOT NULL REFERENCES delivery_outbox(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'retrying', 'failed')),
  provider_message_id TEXT,
  error_code TEXT,
  attempted_at TEXT NOT NULL,
  UNIQUE(outbox_id, attempt_number)
);

CREATE TABLE provider_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'resend')),
  provider_event_id TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('received', 'processed', 'ignored')),
  payload_hash TEXT NOT NULL,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE operator_delivery_preferences (
  operator_id TEXT PRIMARY KEY NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  booking_mail_muted INTEGER NOT NULL DEFAULT 0 CHECK (booking_mail_muted IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
