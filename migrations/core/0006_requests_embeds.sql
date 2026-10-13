-- Alternative-time requests and explicit origin allow-lists for public embeds.
-- Requests retain an event-title snapshot so event removal never erases invitee work.

CREATE TABLE availability_request_review_nonces (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL UNIQUE,
  composition_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX availability_request_review_nonces_expiry_idx
  ON availability_request_review_nonces(expires_at, consumed_at);

CREATE TABLE availability_requests (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE RESTRICT,
  event_title TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  invitee_timezone TEXT NOT NULL,
  note TEXT,
  state TEXT NOT NULL CHECK (state IN ('submitted', 'handled', 'closed')),
  nonce_hash TEXT NOT NULL UNIQUE,
  composition_hash TEXT NOT NULL,
  booking_id TEXT,
  submitted_at TEXT NOT NULL,
  handled_at TEXT,
  closed_at TEXT,
  state_changed_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX availability_requests_state_submitted_idx
  ON availability_requests(state, submitted_at);

CREATE INDEX availability_requests_event_type_idx
  ON availability_requests(event_type_id, submitted_at);

CREATE TABLE availability_request_windows (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES availability_requests(id) ON DELETE CASCADE,
  requested_date TEXT NOT NULL CHECK (
    length(requested_date) = 10
    AND requested_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_minute < end_minute),
  UNIQUE(request_id, position)
);

CREATE INDEX availability_request_windows_request_idx
  ON availability_request_windows(request_id, requested_date, start_minute);

CREATE TABLE embed_allowed_origins (
  origin TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
