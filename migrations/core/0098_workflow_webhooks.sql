-- Add transports without changing any previously enabled email rule.
ALTER TABLE workflow_rules ADD COLUMN action_kind TEXT CHECK(action_kind IN ('webhook'));
ALTER TABLE workflow_rules ADD COLUMN trigger_kind TEXT CHECK(trigger_kind IN ('routing-without-booking'));
ALTER TABLE workflow_rules ADD COLUMN routing_form_id TEXT REFERENCES routing_forms(id) ON DELETE CASCADE;
ALTER TABLE workflow_rules ADD COLUMN webhook_subscription_id TEXT REFERENCES webhook_subscriptions(id) ON DELETE SET NULL;

ALTER TABLE webhook_deliveries ADD COLUMN workflow_id TEXT REFERENCES workflow_rules(id) ON DELETE CASCADE;
ALTER TABLE webhook_deliveries ADD COLUMN workflow_version INTEGER;
ALTER TABLE webhook_deliveries ADD COLUMN workflow_occurrence_id TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN workflow_booking_state TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN routing_submission_id TEXT REFERENCES routing_submissions(id) ON DELETE CASCADE;

CREATE TABLE workflow_webhook_runs (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
 booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
 routing_submission_id TEXT REFERENCES routing_submissions(id) ON DELETE CASCADE,
 event_key TEXT NOT NULL,
 delivery_id TEXT REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 UNIQUE(workflow_id,event_key)
);
CREATE INDEX workflow_webhook_runs_booking ON workflow_webhook_runs(booking_id);
