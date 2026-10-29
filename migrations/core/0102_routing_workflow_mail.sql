-- Routing notifications retain a source-bound receipt without inventing a booking.
CREATE TABLE workflow_routing_mail_runs (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
 routing_submission_id TEXT NOT NULL REFERENCES routing_submissions(id) ON DELETE CASCADE,
 outbox_id TEXT NOT NULL UNIQUE,
 recipient_id TEXT NOT NULL,
 workflow_version INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(workflow_id,routing_submission_id,recipient_id)
);
CREATE TRIGGER routing_workflow_mail_removed AFTER DELETE ON workflow_routing_mail_runs BEGIN
 DELETE FROM delivery_outbox WHERE id=OLD.outbox_id;
END;
