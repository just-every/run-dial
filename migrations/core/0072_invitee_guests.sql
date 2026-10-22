-- EVENT-009: guest access is disabled for all existing event types and bookings.
ALTER TABLE event_types ADD COLUMN guest_limit INTEGER NOT NULL DEFAULT 0 CHECK (guest_limit BETWEEN 0 AND 20);
ALTER TABLE bookings ADD COLUMN guest_limit INTEGER NOT NULL DEFAULT 0 CHECK (guest_limit BETWEEN 0 AND 20);
CREATE TABLE booking_guests (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, email)
);
CREATE INDEX booking_guests_email_idx ON booking_guests(email);
