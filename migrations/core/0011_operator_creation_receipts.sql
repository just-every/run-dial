-- Authenticated operator retry identities contain no invitee payload or raw key.
CREATE TABLE operator_creation_receipts (
  key_hash TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX operator_creation_receipts_booking_idx ON operator_creation_receipts(booking_id);
