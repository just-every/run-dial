CREATE TABLE calendar_connection_health_changes (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'calendar.connection-health-changed.v1',
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX calendar_connection_health_changes_recent_idx ON calendar_connection_health_changes(occurred_at, id);
