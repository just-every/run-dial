-- EVENT-008: existing events keep immediate confirmation. Approval requests are separate tentative holds;
-- no booking, destination event, conference or reminder exists until the owner approves.
ALTER TABLE event_types ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0 CHECK (approval_required IN (0,1));
ALTER TABLE event_types ADD COLUMN approval_window_hours INTEGER NOT NULL DEFAULT 24 CHECK (approval_window_hours BETWEEN 1 AND 168);
CREATE TABLE booking_approval_requests (
  id TEXT PRIMARY KEY NOT NULL,
  nonce_id TEXT NOT NULL UNIQUE,
  link_id TEXT,
  booking_id TEXT NOT NULL UNIQUE,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','declined','expired')),
  invitee_email TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  event_title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  occupied_start_at TEXT NOT NULL,
  occupied_end_at TEXT NOT NULL,
  host_date TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claim_json TEXT,
  decided_by TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX booking_approval_pending_idx ON booking_approval_requests(state,expires_at);
CREATE INDEX booking_approval_email_idx ON booking_approval_requests(invitee_email);
CREATE TABLE booking_approval_tokens (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES booking_approval_requests(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
