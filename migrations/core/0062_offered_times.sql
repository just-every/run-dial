-- Offered times retain their definition; only a live private token activates a hold.
ALTER TABLE booking_links ADD COLUMN offered_slots_json TEXT;
ALTER TABLE booking_links ADD COLUMN hold_until TEXT;
CREATE INDEX booking_links_active_holds_idx ON booking_links(hold_until) WHERE consumed_at IS NULL AND revoked_at IS NULL;
