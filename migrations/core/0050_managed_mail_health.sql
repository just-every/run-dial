-- Add the Managed relay identity without changing any existing provider health.
ALTER TABLE provider_connection_health RENAME TO provider_connection_health_before_managed_mail;
CREATE TABLE provider_connection_health (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('google_calendar', 'resend', 'sendgrid', 'rer', 'development')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  last_checked_at TEXT,
  unhealthy_code TEXT,
  alert_state TEXT NOT NULL CHECK (alert_state IN ('healthy_announced', 'unhealthy_announced', 'unannounced')),
  alert_cycle INTEGER NOT NULL DEFAULT 0 CHECK (alert_cycle >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO provider_connection_health SELECT * FROM provider_connection_health_before_managed_mail;
DROP TABLE provider_connection_health_before_managed_mail;
