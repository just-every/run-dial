-- An authenticated browser report, not an attestation of clipboard contents.
CREATE TABLE host_link_copy_reports (
  id TEXT PRIMARY KEY NOT NULL,
  event_type_id TEXT NOT NULL UNIQUE REFERENCES event_types(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Invalidate within the same write, including disable/re-enable and slug reversals.
CREATE TRIGGER host_link_copy_event_changed AFTER UPDATE OF slug, status, request_only, alternative_requests_enabled ON event_types
WHEN OLD.slug IS NOT NEW.slug OR OLD.status IS NOT NEW.status OR OLD.request_only IS NOT NEW.request_only OR OLD.alternative_requests_enabled IS NOT NEW.alternative_requests_enabled
BEGIN
  DELETE FROM host_link_copy_reports WHERE event_type_id = NEW.id;
END;

CREATE TRIGGER host_link_copy_profile_changed AFTER UPDATE OF handle, name, timezone ON host_profiles
WHEN OLD.handle IS NOT NEW.handle OR OLD.name IS NOT NEW.name OR OLD.timezone IS NOT NEW.timezone
BEGIN
  DELETE FROM host_link_copy_reports;
END;

CREATE TRIGGER host_link_copy_profile_deleted AFTER DELETE ON host_profiles
BEGIN
  DELETE FROM host_link_copy_reports;
END;
