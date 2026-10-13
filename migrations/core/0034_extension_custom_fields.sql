-- Internal operator annotations. Only ext-owned sidecars; existing rows untouched.
CREATE TABLE ext_custom_field_definitions (
 id TEXT PRIMARY KEY NOT NULL, entity TEXT NOT NULL CHECK(entity IN ('eventType','booking','availabilityRequest')),
 label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 120),
 kind TEXT NOT NULL CHECK(kind IN ('text','long_text','single_choice','checkbox')),
 options_json TEXT NOT NULL CHECK(json_valid(options_json) AND json_type(options_json)='array'),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,entity,kind),
 CHECK((kind='single_choice' AND json_array_length(options_json) BETWEEN 1 AND 50) OR (kind<>'single_choice' AND json_array_length(options_json)=0))
);
CREATE TABLE ext_custom_field_values (
 id TEXT PRIMARY KEY NOT NULL, definition_id TEXT NOT NULL, entity TEXT NOT NULL, kind TEXT NOT NULL,
 event_type_id TEXT REFERENCES event_types(id) ON DELETE CASCADE,
 booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
 request_id TEXT REFERENCES availability_requests(id) ON DELETE CASCADE,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(definition_id,entity,kind) REFERENCES ext_custom_field_definitions(id,entity,kind) ON DELETE CASCADE,
 UNIQUE(definition_id,event_type_id), UNIQUE(definition_id,booking_id), UNIQUE(definition_id,request_id),
 CHECK((entity='eventType' AND event_type_id IS NOT NULL AND booking_id IS NULL AND request_id IS NULL) OR
 (entity='booking' AND event_type_id IS NULL AND booking_id IS NOT NULL AND request_id IS NULL) OR
 (entity='availabilityRequest' AND event_type_id IS NULL AND booking_id IS NULL AND request_id IS NOT NULL)),
 CHECK((kind='checkbox' AND json_type(value_json) IN ('true','false')) OR
 (kind IN ('text','long_text','single_choice') AND json_type(value_json)='text' AND length(json_extract(value_json,'$')) <= CASE WHEN kind='long_text' THEN 5000 WHEN kind='text' THEN 500 ELSE 120 END))
);
CREATE INDEX ext_custom_fields_entity_idx ON ext_custom_field_definitions(entity);
CREATE INDEX ext_custom_fields_event_idx ON ext_custom_field_values(event_type_id);
CREATE INDEX ext_custom_fields_booking_idx ON ext_custom_field_values(booking_id);
CREATE INDEX ext_custom_fields_request_idx ON ext_custom_field_values(request_id);
