CREATE TABLE availability_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  windows_json TEXT NOT NULL CHECK (json_valid(windows_json)),
  block_us_holidays INTEGER NOT NULL DEFAULT 0 CHECK (block_us_holidays IN (0,1)),
  reopened_holidays_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reopened_holidays_json)),
  time_off_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(time_off_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE event_schedule_bindings (
  event_type_id TEXT PRIMARY KEY REFERENCES event_types(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES availability_schedules(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX event_schedule_bindings_schedule ON event_schedule_bindings(schedule_id);
CREATE TABLE booking_limit_policies (
  scope TEXT PRIMARY KEY,
  limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX booking_occurrences_limits_start ON booking_occurrences(start_at) WHERE is_current=1;
CREATE INDEX bookings_limits_invitee ON bookings(lower(trim(invitee_email)),state);
CREATE TRIGGER event_booking_limits_delete AFTER DELETE ON event_types BEGIN
  DELETE FROM booking_limit_policies WHERE scope=OLD.id;
END;
