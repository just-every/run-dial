-- Expand the calendar provider constraint without changing existing connection data.
CREATE TABLE calendar_connections_microsoft (
  singleton_key TEXT PRIMARY KEY NOT NULL CHECK (singleton_key = 'default'),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  status TEXT NOT NULL CHECK (status IN ('disconnected', 'healthy', 'unhealthy')),
  authorised_by_operator_id TEXT,
  account_email TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TEXT,
  sync_cursor TEXT,
  channel_id TEXT,
  channel_resource_id TEXT,
  channel_expires_at TEXT,
  last_checked_at TEXT,
  last_successful_read_at TEXT,
  unhealthy_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO calendar_connections_microsoft SELECT * FROM calendar_connections;
DROP TABLE calendar_connections;
ALTER TABLE calendar_connections_microsoft RENAME TO calendar_connections;
