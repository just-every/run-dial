CREATE TABLE analytics_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK (id='default'),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE analytics_connections (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('google_ads','linkedin')),
  generation INTEGER NOT NULL CHECK (generation>0),
  status TEXT NOT NULL CHECK (status IN ('connected','disconnected','needs_reconnect')),
  credential_ciphertext TEXT,
  destination_json TEXT NOT NULL CHECK (json_valid(destination_json)),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE analytics_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_ads','linkedin')),
  generation INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  click_id TEXT NOT NULL,
  destination_json TEXT NOT NULL CHECK (json_valid(destination_json)),
  confirmed_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','processing','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  reason TEXT,
  archive_historical INTEGER NOT NULL DEFAULT 0 CHECK (archive_historical IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(booking_id,provider)
);
CREATE INDEX analytics_deliveries_due ON analytics_deliveries(state,next_attempt_at);
