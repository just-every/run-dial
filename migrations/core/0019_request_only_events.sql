-- Explicit publication mode; existing installations keep their booking behavior.
ALTER TABLE event_types ADD COLUMN request_only INTEGER NOT NULL DEFAULT 0 CHECK(request_only IN (0,1));
CREATE TRIGGER request_only_booking_insert BEFORE INSERT ON bookings
WHEN EXISTS(SELECT 1 FROM event_types WHERE id=NEW.event_type_id AND request_only=1)
BEGIN SELECT RAISE(ABORT,'request_only_event'); END;
CREATE TRIGGER request_only_occurrence_insert BEFORE INSERT ON booking_occurrences
WHEN NEW.state='current' AND EXISTS(SELECT 1 FROM bookings b JOIN event_types e ON e.id=b.event_type_id WHERE b.id=NEW.booking_id AND e.request_only=1)
BEGIN SELECT RAISE(ABORT,'request_only_event'); END;
