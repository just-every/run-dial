-- Retain only the salted random attempt identity after booking erasure.
-- Invitee payload hashes and booking references are deleted by the 0011 cascade.
CREATE TABLE operator_creation_tombstones (
  key_hash TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TRIGGER operator_creation_erasure_guard
BEFORE DELETE ON bookings
BEGIN
  INSERT OR IGNORE INTO operator_creation_tombstones (key_hash, operator_id, created_at)
  SELECT key_hash, operator_id, created_at FROM operator_creation_receipts
  WHERE booking_id = OLD.id;
END;
