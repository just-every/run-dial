-- Restoring a native role or status cannot revive its old API authority.
CREATE TRIGGER api_native_authority_changed AFTER UPDATE OF role,status ON oa_operators
 WHEN OLD.role != NEW.role OR OLD.status != NEW.status
 BEGIN
  UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE operator_id=NEW.id OR oauth_application_id IN (SELECT id FROM api_oauth_applications WHERE operator_id=NEW.id);
  UPDATE api_oauth_grants SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE operator_id=NEW.id OR application_id IN (SELECT id FROM api_oauth_applications WHERE operator_id=NEW.id);
  UPDATE api_oauth_applications SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE operator_id=NEW.id;
 END;
