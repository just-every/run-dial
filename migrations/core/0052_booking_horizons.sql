-- Preserve every event and its configured increment while widening the constraint.
ALTER TABLE event_types ADD COLUMN scheduling_increment INTEGER NOT NULL DEFAULT 15
  CHECK (scheduling_increment IN (5, 10, 15, 30, 45, 60));
UPDATE event_types SET scheduling_increment = slot_increment_minutes;
ALTER TABLE event_types DROP COLUMN slot_increment_minutes;
ALTER TABLE event_types RENAME COLUMN scheduling_increment TO slot_increment_minutes;
ALTER TABLE event_types ADD COLUMN booking_horizon_mode TEXT NOT NULL DEFAULT 'calendar_days'
  CHECK (booking_horizon_mode IN ('calendar_days', 'weekdays', 'fixed_range', 'indefinite'));
ALTER TABLE event_types ADD COLUMN booking_start_date TEXT;
ALTER TABLE event_types ADD COLUMN booking_end_date TEXT;
