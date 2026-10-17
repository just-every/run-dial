CREATE TABLE event_booking_policies (
  event_type_id TEXT PRIMARY KEY REFERENCES event_types(id) ON DELETE CASCADE,
  locked_timezone TEXT,
  reschedule_cutoff_minutes INTEGER CHECK(reschedule_cutoff_minutes IS NULL OR reschedule_cutoff_minutes BETWEEN 0 AND 2147483647),
  cancellation_cutoff_minutes INTEGER CHECK(cancellation_cutoff_minutes IS NULL OR cancellation_cutoff_minutes BETWEEN 0 AND 2147483647),
  reschedule_cap INTEGER CHECK(reschedule_cap IS NULL OR reschedule_cap BETWEEN 0 AND 2147483647),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE booking_presentation (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  locked_timezone TEXT NOT NULL,
  browser_timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
