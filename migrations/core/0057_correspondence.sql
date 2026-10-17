CREATE TABLE event_correspondence (
  event_type_id TEXT PRIMARY KEY REFERENCES event_types(id) ON DELETE CASCADE,
  templates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE booking_correspondence (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  templates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Deleting an offer must preserve its last correspondence settings for surviving bookings.
CREATE TRIGGER retain_deleted_event_correspondence BEFORE DELETE ON event_types BEGIN
  INSERT INTO booking_correspondence (booking_id,templates_json,created_at,updated_at)
  SELECT b.id,c.templates_json,c.created_at,c.updated_at FROM bookings b
    JOIN event_correspondence c ON c.event_type_id=b.event_type_id
    WHERE b.event_type_id=OLD.id
  ON CONFLICT(booking_id) DO UPDATE SET templates_json=excluded.templates_json,updated_at=excluded.updated_at;
END;
