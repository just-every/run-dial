-- Expand provider identities without changing existing health, receipts or admission data.

ALTER TABLE provider_connection_health RENAME TO provider_connection_health_before_sendgrid;
CREATE TABLE provider_connection_health (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('google_calendar', 'resend', 'sendgrid')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  last_checked_at TEXT,
  unhealthy_code TEXT,
  alert_state TEXT NOT NULL CHECK (alert_state IN ('healthy_announced', 'unhealthy_announced', 'unannounced')),
  alert_cycle INTEGER NOT NULL DEFAULT 0 CHECK (alert_cycle >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO provider_connection_health SELECT * FROM provider_connection_health_before_sendgrid;
DROP TABLE provider_connection_health_before_sendgrid;
ALTER TABLE provider_webhook_events RENAME TO provider_webhook_events_before_sendgrid;
CREATE TABLE provider_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'resend', 'sendgrid')),
  provider_event_id TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('received', 'processed', 'ignored')),
  payload_hash TEXT NOT NULL,
  UNIQUE(provider, provider_event_id)
);
INSERT INTO provider_webhook_events SELECT * FROM provider_webhook_events_before_sendgrid;
DROP TABLE provider_webhook_events_before_sendgrid;
ALTER TABLE public_rate_events RENAME TO public_rate_events_before_sendgrid;
CREATE TABLE public_rate_events (
  id TEXT PRIMARY KEY NOT NULL,
  client_key TEXT NOT NULL,
  booking_mutation INTEGER NOT NULL CHECK (booking_mutation IN (0, 1)),
  alternative_submission INTEGER NOT NULL CHECK (alternative_submission IN (0, 1)),
  provider TEXT CHECK (provider IN ('google_calendar', 'resend', 'sendgrid')),
  admitted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO public_rate_events SELECT * FROM public_rate_events_before_sendgrid;
DROP TABLE public_rate_events_before_sendgrid;
CREATE INDEX public_rate_client_time ON public_rate_events(client_key, admitted_at);
CREATE INDEX public_rate_booking_time ON public_rate_events(client_key, admitted_at) WHERE booking_mutation = 1;
CREATE INDEX public_rate_request_time ON public_rate_events(client_key, admitted_at) WHERE alternative_submission = 1;
CREATE INDEX public_rate_provider_time ON public_rate_events(provider, admitted_at) WHERE provider IS NOT NULL;
CREATE INDEX public_rate_expiry ON public_rate_events(expires_at);
