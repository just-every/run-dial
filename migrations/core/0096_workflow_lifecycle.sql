ALTER TABLE workflow_rules ADD COLUMN trigger TEXT NOT NULL DEFAULT 'booking-created'
 CHECK(trigger IN ('booking-created','booking-rescheduled','booking-canceled','before-start','after-end','marked-attended','marked-no-show','payment-received'));
ALTER TABLE workflow_rules ADD COLUMN action TEXT NOT NULL DEFAULT 'email-invitee' CHECK(action IN ('email-invitee','email-hosts'));
ALTER TABLE workflow_rules ADD COLUMN offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK(offset_minutes BETWEEN 0 AND 43200);

-- Preserve the existing once-only receipts while allowing each later lifecycle
-- event and each authorized recipient to have its own durable delivery.
ALTER TABLE workflow_dispatches RENAME TO workflow_dispatches_previous;
CREATE TABLE workflow_dispatches (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 outbox_id TEXT NOT NULL UNIQUE,
 workflow_version INTEGER NOT NULL,
 event_key TEXT NOT NULL,
 recipient_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(workflow_id,booking_id,event_key,recipient_key)
);
INSERT INTO workflow_dispatches(id,workflow_id,booking_id,outbox_id,workflow_version,event_key,recipient_key,created_at)
 SELECT id,workflow_id,booking_id,outbox_id,workflow_version,'booking-created','invitee',created_at FROM workflow_dispatches_previous;
DROP TABLE workflow_dispatches_previous;
CREATE INDEX workflow_dispatches_booking ON workflow_dispatches(booking_id);
