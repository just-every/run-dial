-- Date-specific availability replaces a recurring schedule for exactly one host date.
CREATE TABLE availability_date_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  host_date TEXT NOT NULL CHECK (
    length(host_date) = 10
    AND host_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  mode TEXT NOT NULL CHECK (mode IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_type_id, host_date)
);

CREATE INDEX availability_date_overrides_event_date_idx
  ON availability_date_overrides(event_type_id, host_date);

CREATE TABLE availability_date_override_windows (
  id TEXT PRIMARY KEY NOT NULL,
  override_id TEXT NOT NULL REFERENCES availability_date_overrides(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_minute < end_minute),
  UNIQUE(override_id, position)
);
