-- Track explicit local mail health without claiming a remote provider connection.
-- Preserve all existing provider health rows and authored application data.

ALTER TABLE provider_connection_health RENAME TO provider_connection_health_before_development;
CREATE TABLE provider_connection_health (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('google_calendar', 'resend', 'sendgrid', 'development')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  last_checked_at TEXT,
  unhealthy_code TEXT,
  alert_state TEXT NOT NULL CHECK (alert_state IN ('healthy_announced', 'unhealthy_announced', 'unannounced')),
  alert_cycle INTEGER NOT NULL DEFAULT 0 CHECK (alert_cycle >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO provider_connection_health SELECT * FROM provider_connection_health_before_development;
DROP TABLE provider_connection_health_before_development;
