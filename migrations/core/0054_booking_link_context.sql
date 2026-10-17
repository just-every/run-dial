ALTER TABLE event_types ADD COLUMN post_booking_redirect_json TEXT DEFAULT NULL
  CHECK (post_booking_redirect_json IS NULL OR (json_valid(post_booking_redirect_json) AND json_type(post_booking_redirect_json) = 'object'));
ALTER TABLE event_questions ADD COLUMN private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1));
ALTER TABLE bookings ADD COLUMN attribution_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attribution_json) AND json_type(attribution_json) = 'object');
ALTER TABLE bookings ADD COLUMN post_booking_redirect_url TEXT DEFAULT NULL;
