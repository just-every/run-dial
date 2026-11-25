-- Indexes that keep each minute's scheduled work independent of how much history a company has stored.
CREATE INDEX bookings_event_created_idx ON bookings(event_type_id, created_at);
CREATE INDEX workflow_dispatches_rule_time ON workflow_dispatches(workflow_id, created_at);
CREATE INDEX payment_movements_void_pending_idx ON payment_movements(updated_at) WHERE status = 'failed' AND failure_code = 'void_pending';
CREATE INDEX meeting_polls_open_closing_idx ON meeting_polls(closes_at) WHERE state = 'open';
