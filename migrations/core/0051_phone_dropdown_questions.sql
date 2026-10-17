-- Expand question kinds while preserving existing public identities and ordering.
-- No triggers or foreign keys reference event_questions in the preceding schema.
CREATE TABLE event_questions_v3 (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'textarea', 'phone', 'single_choice', 'dropdown', 'multiple_choice', 'checkbox')),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  public_key TEXT
);

INSERT INTO event_questions_v3 (id, event_type_id, position, kind, label, required, options_json, created_at, updated_at, public_key)
SELECT id, event_type_id, position, kind, label, required, options_json, created_at, updated_at, public_key
FROM event_questions;

DROP TABLE event_questions;
ALTER TABLE event_questions_v3 RENAME TO event_questions;
CREATE UNIQUE INDEX event_questions_position_idx ON event_questions(event_type_id, position);
CREATE UNIQUE INDEX event_questions_public_key_idx ON event_questions(event_type_id, public_key);
