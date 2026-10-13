-- Operator workspace configuration. This migration extends, rather than rewrites,
-- the initial configuration spine.
ALTER TABLE host_profiles RENAME COLUMN headline TO title;

ALTER TABLE event_types ADD COLUMN slot_increment_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (slot_increment_minutes IN (5, 10, 15, 30, 60));
ALTER TABLE event_types ADD COLUMN minimum_notice_minutes INTEGER NOT NULL DEFAULT 240
  CHECK (minimum_notice_minutes BETWEEN 0 AND 10080);
ALTER TABLE event_types ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 60
  CHECK (booking_horizon_days BETWEEN 1 AND 365);
ALTER TABLE event_types ADD COLUMN before_buffer_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (before_buffer_minutes BETWEEN 0 AND 120);
ALTER TABLE event_types ADD COLUMN after_buffer_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (after_buffer_minutes BETWEEN 0 AND 120);
ALTER TABLE event_types ADD COLUMN host_day_booking_limit INTEGER
  CHECK (host_day_booking_limit IS NULL OR host_day_booking_limit > 0);
ALTER TABLE event_types ADD COLUMN location_value TEXT NOT NULL DEFAULT '';

UPDATE event_types
SET location_type = 'google_meet', location_label = 'Google Meet'
WHERE location_type = 'video';

CREATE TABLE event_questions_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'textarea', 'single_choice', 'multiple_choice', 'checkbox')),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO event_questions_v2 (id, event_type_id, position, kind, label, required, options_json, created_at, updated_at)
SELECT id, event_type_id, position,
  CASE kind
    WHEN 'short_text' THEN 'text'
    WHEN 'long_text' THEN 'textarea'
    ELSE 'single_choice'
  END,
  label, required, options_json, created_at, updated_at
FROM event_questions;

DROP TABLE event_questions;
ALTER TABLE event_questions_v2 RENAME TO event_questions;
CREATE UNIQUE INDEX event_questions_position_idx ON event_questions(event_type_id, position);

-- This table is used solely by the local development magic-link sink. It is
-- written and readable only when ENVIRONMENT=development with a loopback APP_URL.
CREATE TABLE development_magic_link_sink (
  singleton_key TEXT PRIMARY KEY NOT NULL CHECK (singleton_key = 'default'),
  link TEXT NOT NULL,
  created_at TEXT NOT NULL
);
