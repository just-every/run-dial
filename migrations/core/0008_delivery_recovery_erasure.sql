-- Additive; preserves the seven existing applied migrations and booking history.
CREATE TABLE anonymized_audit (
 id TEXT PRIMARY KEY NOT NULL,
 entity_kind TEXT NOT NULL,
 action TEXT NOT NULL,
 actor_type TEXT NOT NULL,
 actor_id TEXT,
 happened_at TEXT NOT NULL,
 erased_at TEXT NOT NULL
);
CREATE TABLE erased_calendar_targets (
 booking_id TEXT PRIMARY KEY NOT NULL,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 last_error_code TEXT
);
