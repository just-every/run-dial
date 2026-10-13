-- Ephemeral admission state only. Existing product records and migrations are unchanged.
CREATE TABLE public_rate_events (
  id TEXT PRIMARY KEY NOT NULL,
  client_key TEXT NOT NULL,
  booking_mutation INTEGER NOT NULL CHECK (booking_mutation IN (0, 1)),
  alternative_submission INTEGER NOT NULL CHECK (alternative_submission IN (0, 1)),
  provider TEXT CHECK (provider IN ('google_calendar', 'resend')),
  admitted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX public_rate_client_time ON public_rate_events(client_key, admitted_at);
CREATE INDEX public_rate_booking_time ON public_rate_events(client_key, admitted_at) WHERE booking_mutation = 1;
CREATE INDEX public_rate_request_time ON public_rate_events(client_key, admitted_at) WHERE alternative_submission = 1;
CREATE INDEX public_rate_provider_time ON public_rate_events(provider, admitted_at) WHERE provider IS NOT NULL;
CREATE INDEX public_rate_expiry ON public_rate_events(expires_at);
