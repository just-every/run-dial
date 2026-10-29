CREATE TABLE api_request_keys (
  id TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','erased')),
  response_json TEXT,
  response_status INTEGER,
  booking_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(credential_id,key_hash)
);
CREATE INDEX api_request_keys_booking_idx ON api_request_keys(booking_id);
CREATE TABLE api_rate_windows (
  id TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(credential_id,window_started_at)
);
CREATE TRIGGER api_booking_erasure BEFORE DELETE ON bookings BEGIN
  UPDATE api_request_keys SET state='erased',request_hash=NULL,response_json=NULL,response_status=410,booking_id=NULL WHERE booking_id=OLD.id;
END;
