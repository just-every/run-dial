CREATE TABLE event_follow_up_settings (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL UNIQUE REFERENCES event_types(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  kind TEXT NOT NULL DEFAULT 'thank_you' CHECK(kind IN ('thank_you','rebooking','feedback')),
  message_text TEXT NOT NULL DEFAULT 'Thank you for meeting, {invitee first name}.',
  offset_minutes INTEGER NOT NULL DEFAULT 60 CHECK(offset_minutes BETWEEN 1 AND 43200),
  attended_only INTEGER NOT NULL DEFAULT 0 CHECK(attended_only IN (0,1)),
  target_event_type_id TEXT REFERENCES event_types(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE follow_up_runs (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','waiting','queued','skipped','failed')),
  reason TEXT,
  outbox_id TEXT,
  archive_historical INTEGER NOT NULL DEFAULT 0 CHECK(archive_historical IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(booking_id,occurrence_id)
);
CREATE INDEX follow_up_runs_due_idx ON follow_up_runs(state,due_at);
CREATE TRIGGER follow_up_occurrence_closed AFTER UPDATE OF current_occurrence_id,state ON bookings
BEGIN
  UPDATE follow_up_runs SET state='skipped',reason=CASE WHEN NEW.state='cancelled' THEN 'booking_cancelled' ELSE 'superseded_occurrence' END,updated_at=NEW.updated_at
  WHERE booking_id=NEW.id AND state IN ('pending','waiting','queued') AND NOT EXISTS(SELECT 1 FROM delivery_outbox d WHERE d.id=follow_up_runs.outbox_id AND d.state='succeeded') AND (NEW.state='cancelled' OR occurrence_id IS NOT NEW.current_occurrence_id);
END;
