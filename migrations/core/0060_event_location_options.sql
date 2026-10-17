-- Retain the original primary fields for existing installations and snapshot bookings.
ALTER TABLE event_types ADD COLUMN locations_json TEXT;
