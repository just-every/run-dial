-- Expand the existing history's action constraint. Preserve every historical
-- row, column, primary key and foreign key; no token material enters the audit.
CREATE TABLE booking_request_history_expanded (
 id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES booking_occurrences(id) ON DELETE SET NULL,
 action TEXT NOT NULL CHECK(action IN ('reschedule_requested','reschedule_request_reminded','reschedule_request_picked','reschedule_request_expired','manage_link_rotated')),
 actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system','invitee')),
 actor_id TEXT,
 reason TEXT,
 created_at TEXT NOT NULL
);
INSERT INTO booking_request_history_expanded SELECT * FROM booking_request_history;
DROP TRIGGER close_reschedule_request_on_pick;
DROP TABLE booking_request_history;
ALTER TABLE booking_request_history_expanded RENAME TO booking_request_history;
CREATE TRIGGER close_reschedule_request_on_pick AFTER UPDATE OF current_occurrence_id ON bookings
WHEN NEW.current_occurrence_id<>OLD.current_occurrence_id BEGIN
 INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,created_at)
 SELECT NEW.current_occurrence_id,NEW.id,NEW.current_occurrence_id,'reschedule_request_picked','system',NEW.updated_at
 FROM booking_reschedule_requests WHERE booking_id=NEW.id AND state='open' AND archive_historical=0;
 UPDATE booking_reschedule_requests SET state='picked',updated_at=NEW.updated_at WHERE booking_id=NEW.id AND state='open' AND archive_historical=0;
END;
