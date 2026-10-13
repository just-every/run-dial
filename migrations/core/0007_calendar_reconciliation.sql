-- Provider event ids are retained only for Dial-managed destination events.
-- A deleted Google event can omit extended properties, so its id remains the safe lookup key.

ALTER TABLE bookings ADD COLUMN calendar_provider_event_id TEXT;
ALTER TABLE bookings ADD COLUMN calendar_provider_updated_at TEXT;
CREATE UNIQUE INDEX bookings_calendar_provider_event_idx
  ON bookings(calendar_provider_event_id)
  WHERE calendar_provider_event_id IS NOT NULL;

CREATE TABLE booking_calendar_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  provider_updated_at TEXT NOT NULL,
  canonical_start_at TEXT NOT NULL,
  canonical_end_at TEXT NOT NULL,
  canonical_location TEXT NOT NULL,
  external_start_at TEXT,
  external_end_at TEXT,
  external_location TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'restored', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(booking_id, occurrence_id, provider_event_id, provider_updated_at)
);

CREATE INDEX booking_calendar_conflicts_open_idx
  ON booking_calendar_conflicts(booking_id, state, created_at);
