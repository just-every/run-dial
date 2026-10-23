CREATE TABLE client_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE client_aliases (
  email TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES client_profiles(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX client_aliases_client ON client_aliases(client_id);
CREATE TABLE client_notes (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES client_profiles(id),
  body TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE client_fields (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES client_profiles(id),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER client_alias_insert_erasure BEFORE INSERT ON client_aliases
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.email)
 OR EXISTS(SELECT 1 FROM client_aliases a JOIN person_erasure_locks l ON l.email=a.email WHERE a.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'client_erasure_pending'); END;
CREATE TRIGGER client_alias_update_erasure BEFORE UPDATE ON client_aliases
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email IN(NEW.email,OLD.email))
 OR EXISTS(SELECT 1 FROM client_aliases a JOIN person_erasure_locks l ON l.email=a.email WHERE a.client_id IN(OLD.client_id,NEW.client_id))
BEGIN SELECT RAISE(ABORT,'client_erasure_pending'); END;
CREATE TRIGGER client_note_insert_erasure BEFORE INSERT ON client_notes
WHEN EXISTS(SELECT 1 FROM client_aliases a JOIN person_erasure_locks l ON l.email=a.email WHERE a.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'client_erasure_pending'); END;
CREATE TRIGGER client_field_insert_erasure BEFORE INSERT ON client_fields
WHEN EXISTS(SELECT 1 FROM client_aliases a JOIN person_erasure_locks l ON l.email=a.email WHERE a.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'client_erasure_pending'); END;
