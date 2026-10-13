-- Retain operator identities and all authored records when access is removed.
ALTER TABLE operators ADD COLUMN removed_at TEXT;
CREATE TABLE operator_setup_identity (
  singleton_key TEXT PRIMARY KEY NOT NULL CHECK (singleton_key = 'default'),
  operator_id TEXT NOT NULL REFERENCES operators(id),
  created_at TEXT NOT NULL
);
-- Setup must record its actual operator explicitly. Existing rows are not guessed.
CREATE TRIGGER operator_access_revoked AFTER UPDATE OF removed_at ON operators
WHEN NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL
BEGIN
  UPDATE operator_sessions SET revoked_at = NEW.removed_at, updated_at = NEW.removed_at
    WHERE operator_id = NEW.id AND revoked_at IS NULL;
  UPDATE magic_link_tokens SET consumed_at = NEW.removed_at, updated_at = NEW.removed_at
    WHERE operator_id = NEW.id AND consumed_at IS NULL;
END;
