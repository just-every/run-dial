-- DATA-003 cutover: what each applied capture recorded natively, so the
-- switch-over checklist, the differences list and the old scheduling links
-- survive reload and whole-install archives without the private import plan.
-- captured_at is the manifest capture time, NULL for an import applied before
-- this version.
CREATE TABLE move_in_captures (
  job_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('first', 'catch_up')),
  source_handle TEXT NOT NULL,
  captured_at TEXT,
  as_of TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE move_in_source_links (
  event_type_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  job_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE move_in_differences (
  job_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('unchanged', 'moved', 'cancelled', 'invitee_changed', 'missing')),
  source_start_at TEXT,
  source_end_at TEXT,
  decision TEXT CHECK (decision IN ('kept', 'released')),
  decided_at TEXT,
  PRIMARY KEY (job_id, booking_id)
);
CREATE INDEX move_in_differences_booking ON move_in_differences(booking_id);
