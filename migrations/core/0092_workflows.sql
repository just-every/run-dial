CREATE TABLE workflow_rules (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 enabled_at TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 subject TEXT NOT NULL,
 text TEXT NOT NULL,
 removed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX workflow_rules_event ON workflow_rules(event_type_id);
CREATE TABLE workflow_dispatches (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 outbox_id TEXT NOT NULL UNIQUE,
 workflow_version INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(workflow_id,booking_id)
);
CREATE INDEX workflow_dispatches_booking ON workflow_dispatches(booking_id);
