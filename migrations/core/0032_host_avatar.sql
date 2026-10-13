-- Additive: preserve all populated host records and their timestamps.
ALTER TABLE host_profiles ADD COLUMN avatar_key TEXT;
ALTER TABLE host_profiles ADD COLUMN avatar_content_type TEXT;
-- Retain cleanup authority across a failed R2 delete or Worker restart.
CREATE TABLE avatar_object_deletions (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
