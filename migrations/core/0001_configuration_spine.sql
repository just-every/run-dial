-- The initial Dial data model. This migration is immutable once released.
CREATE TABLE operators (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX magic_link_tokens_operator_id_idx ON magic_link_tokens(operator_id);

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX operator_sessions_active_idx ON operator_sessions(token_hash, expires_at, revoked_at);

CREATE TABLE host_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  singleton_key TEXT NOT NULL UNIQUE CHECK (singleton_key = 'default'),
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  headline TEXT NOT NULL,
  biography TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE profile_focus_areas (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES host_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX profile_focus_areas_position_idx ON profile_focus_areas(profile_id, position);

CREATE TABLE social_proof_entries (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES host_profiles(id) ON DELETE CASCADE,
  quote TEXT NOT NULL,
  attribution TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX social_proof_entries_position_idx ON social_proof_entries(profile_id, position);

CREATE TABLE event_types (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'disabled')),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  color TEXT NOT NULL,
  location_type TEXT NOT NULL,
  location_label TEXT NOT NULL,
  listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
  alternative_requests_enabled INTEGER NOT NULL DEFAULT 1 CHECK (alternative_requests_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_questions (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('short_text', 'long_text', 'select')),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX event_questions_position_idx ON event_questions(event_type_id, position);

CREATE TABLE recurring_availability_windows (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_minute < end_minute)
);

CREATE INDEX recurring_availability_event_type_idx ON recurring_availability_windows(event_type_id, weekday);
