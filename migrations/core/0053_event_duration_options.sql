ALTER TABLE event_types ADD COLUMN duration_options_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(duration_options_json) AND json_type(duration_options_json) = 'array');
UPDATE event_types SET duration_options_json = json_array(duration_minutes);
-- Existing import plans may omit the additive column; keep their saved duration.
CREATE TRIGGER event_duration_options_insert AFTER INSERT ON event_types
WHEN NEW.duration_options_json = '[]'
BEGIN UPDATE event_types SET duration_options_json = json_array(NEW.duration_minutes) WHERE id = NEW.id; END;
