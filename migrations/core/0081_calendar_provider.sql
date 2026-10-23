-- Preserve the immutable Google column and expand the single deployment connection.
-- Existing selections and sealed credentials remain Google; no new authority is granted.
ALTER TABLE calendar_connections ADD COLUMN calendar_provider TEXT NOT NULL DEFAULT 'google'
  CHECK (calendar_provider IN ('google', 'microsoft', 'caldav'));
