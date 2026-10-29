-- Revocation is permanent; restoring a role requires fresh explicit grants.
-- The timestamp also distinguishes a revoked rule from an ordinary paused rule.
ALTER TABLE workflow_rules ADD COLUMN authority_revoked_at TEXT;
CREATE TRIGGER workflow_owner_authority_revoked AFTER UPDATE OF role,status ON oa_operators
 WHEN OLD.role='owner' AND OLD.status='active' AND (NEW.role<>'owner' OR NEW.status<>'active') BEGIN
 UPDATE workflow_rules SET enabled=0,enabled_at=NULL,version=version+1,
  authority_revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE operator_id=OLD.id AND enabled=1 AND removed_at IS NULL;
 UPDATE workflow_crm_connections SET status='revoked',credential_ciphertext=NULL,version=version+1,
  reason='owner_authority_revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE operator_id=OLD.id AND credential_ciphertext IS NOT NULL;
END;
