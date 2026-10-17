-- Private offer definitions survive restore; their live capabilities do not.
-- Erasure journals and clears consumed_booking_id before deleting its booking.
CREATE TABLE booking_links (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('single_use','one_off')),
  overrides_json TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_booking_id TEXT REFERENCES bookings(id),
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE booking_link_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  link_id TEXT NOT NULL UNIQUE REFERENCES booking_links(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE booking_nonces ADD COLUMN link_id TEXT REFERENCES booking_links(id) ON DELETE CASCADE;
CREATE INDEX booking_links_event_idx ON booking_links(event_type_id,created_at);
CREATE UNIQUE INDEX booking_links_booking_idx ON booking_links(consumed_booking_id) WHERE consumed_booking_id IS NOT NULL;
