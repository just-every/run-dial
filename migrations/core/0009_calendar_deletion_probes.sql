-- Additive authoritative checks for provider deletions with no source timestamp.
CREATE TABLE calendar_deletion_probes (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'resolved', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (booking_id, provider_event_id)
);
CREATE INDEX calendar_deletion_probes_due ON calendar_deletion_probes(state, next_attempt_at);
