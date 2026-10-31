-- Existing polls remain silent until the owner explicitly configures reminders.
ALTER TABLE meeting_polls ADD COLUMN reminder_offsets_json TEXT NOT NULL DEFAULT '[]'
 CHECK(json_valid(reminder_offsets_json) AND json_type(reminder_offsets_json)='array');
