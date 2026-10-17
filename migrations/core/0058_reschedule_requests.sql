ALTER TABLE booking_occurrences ADD COLUMN blocks_time INTEGER NOT NULL DEFAULT 1 CHECK (blocks_time IN (0,1));

CREATE TABLE booking_reschedule_requests (
 id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK (state IN ('open','picked','expired','cancelled')),
 message TEXT NOT NULL CHECK (length(message)<=1000),
 release_time INTEGER NOT NULL CHECK (release_time IN (0,1)),
 actor_id TEXT NOT NULL,
 archive_historical INTEGER NOT NULL DEFAULT 0 CHECK(archive_historical IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 reminder_at TEXT,
 reminded_at TEXT
);
CREATE UNIQUE INDEX booking_reschedule_request_open ON booking_reschedule_requests(booking_id) WHERE state='open' AND archive_historical=0;
CREATE INDEX booking_reschedule_request_due ON booking_reschedule_requests(state,expires_at,reminder_at);

CREATE TABLE booking_request_history (
 id TEXT PRIMARY KEY NOT NULL,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES booking_occurrences(id) ON DELETE SET NULL,
 action TEXT NOT NULL CHECK(action IN ('reschedule_requested','reschedule_request_reminded','reschedule_request_picked','reschedule_request_expired')),
 actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system','invitee')),
 actor_id TEXT,
 reason TEXT,
 created_at TEXT NOT NULL
);

CREATE TRIGGER close_reschedule_request_on_pick AFTER UPDATE OF current_occurrence_id ON bookings
WHEN NEW.current_occurrence_id<>OLD.current_occurrence_id BEGIN
 INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,created_at)
 SELECT NEW.current_occurrence_id,NEW.id,NEW.current_occurrence_id,'reschedule_request_picked','system',NEW.updated_at
 FROM booking_reschedule_requests WHERE booking_id=NEW.id AND state='open' AND archive_historical=0;
 UPDATE booking_reschedule_requests SET state='picked',updated_at=NEW.updated_at WHERE booking_id=NEW.id AND state='open' AND archive_historical=0;
END;
CREATE TRIGGER close_reschedule_request_on_cancel AFTER UPDATE OF state ON bookings
WHEN NEW.state='cancelled' BEGIN
 UPDATE booking_reschedule_requests SET state='cancelled',updated_at=NEW.updated_at WHERE booking_id=NEW.id AND state='open' AND archive_historical=0;
END;
