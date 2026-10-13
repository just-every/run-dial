-- Booking claims are kept independently of an event type's lifecycle. Event type
-- deletion removes future public availability but never removes confirmed records.

ALTER TABLE event_questions ADD COLUMN public_key TEXT;
UPDATE event_questions
SET public_key = 'q_' || lower(hex(randomblob(16)))
WHERE public_key IS NULL;
CREATE UNIQUE INDEX event_questions_public_key_idx
  ON event_questions(event_type_id, public_key);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT,
  event_slug TEXT NOT NULL,
  event_title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  location_type TEXT NOT NULL,
  location_label TEXT NOT NULL,
  location_value TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  host_timezone TEXT NOT NULL,
  invitee_timezone TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('confirmed', 'cancelled', 'rescheduled')),
  ical_uid TEXT NOT NULL UNIQUE,
  calendar_state TEXT NOT NULL CHECK (calendar_state IN ('pending', 'succeeded', 'failed')),
  meeting_state TEXT NOT NULL CHECK (meeting_state IN ('pending', 'succeeded', 'failed', 'not_required')),
  meeting_url TEXT,
  current_occurrence_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_reason TEXT
);

CREATE INDEX bookings_lifecycle_idx ON bookings(state, created_at);
CREATE INDEX bookings_event_type_idx ON bookings(event_type_id, state);
CREATE INDEX bookings_invitee_lookup_idx ON bookings(invitee_email, invitee_name);

CREATE TABLE booking_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  occupied_start_at TEXT NOT NULL,
  occupied_end_at TEXT NOT NULL,
  host_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('current', 'rescheduled', 'cancelled')),
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  replaced_by_occurrence_id TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (start_at < end_at),
  CHECK (occupied_start_at < occupied_end_at),
  UNIQUE(booking_id, sequence)
);

CREATE UNIQUE INDEX booking_occurrences_one_current_idx
  ON booking_occurrences(booking_id) WHERE is_current = 1;
CREATE INDEX booking_occurrences_conflict_idx
  ON booking_occurrences(occupied_start_at, occupied_end_at, is_current);
CREATE INDEX booking_occurrences_host_date_idx
  ON booking_occurrences(host_date, is_current);

CREATE TABLE booking_answers (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question_label TEXT NOT NULL,
  question_kind TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(booking_id, question_key)
);

CREATE TABLE booking_nonces (
  id TEXT PRIMARY KEY NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'reschedule')),
  event_type_id TEXT NOT NULL,
  booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  selection_start_at TEXT NOT NULL,
  selection_end_at TEXT NOT NULL,
  invitee_timezone TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  payload_hash TEXT,
  result_booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX booking_nonces_lookup_idx ON booking_nonces(nonce_hash, expires_at, consumed_at);

CREATE TABLE booking_manage_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  invalidated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX booking_manage_tokens_lookup_idx
  ON booking_manage_tokens(token_hash, expires_at, rotated_at, invalidated_at);

CREATE TABLE booking_history (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  occurrence_id TEXT REFERENCES booking_occurrences(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'rescheduled', 'cancelled', 'attendance_marked', 'calendar_cancelled')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('invitee', 'operator', 'calendar_provider', 'system')),
  actor_id TEXT,
  previous_start_at TEXT,
  new_start_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX booking_history_booking_idx ON booking_history(booking_id, created_at);

CREATE TABLE booking_attendance (
  booking_id TEXT PRIMARY KEY NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('attended', 'no_show')),
  note TEXT NOT NULL,
  marked_by_operator_id TEXT NOT NULL REFERENCES operators(id),
  marked_at TEXT NOT NULL
);

CREATE TABLE blocked_address_rules (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
  value TEXT NOT NULL,
  created_by_operator_id TEXT NOT NULL REFERENCES operators(id),
  created_at TEXT NOT NULL,
  UNIQUE(kind, value)
);
