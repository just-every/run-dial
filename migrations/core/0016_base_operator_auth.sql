-- Base operator-auth schema adopted as Dial migration 0016.
-- Earlier applied migrations are unchanged. Epoch timestamps are milliseconds.
CREATE TABLE oa_operators (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
 status TEXT NOT NULL CHECK(status IN ('invited','active','inactive')),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE oa_bootstrap (singleton INTEGER PRIMARY KEY CHECK(singleton=1), claim_id TEXT NOT NULL UNIQUE, claimed_at INTEGER NOT NULL);
CREATE TABLE oa_tokens (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('magic','invite')),
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), operator_version INTEGER NOT NULL,
 issuer_id TEXT REFERENCES oa_operators(id), issuer_version INTEGER,
 return_to TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 consumed_at INTEGER, revoked_at INTEGER,
 CHECK((kind='invite' AND issuer_id IS NOT NULL AND issuer_version IS NOT NULL)
    OR (kind='magic' AND issuer_id IS NULL AND issuer_version IS NULL))
);
CREATE TABLE oa_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), operator_version INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('native','review','oidc','password')),
 source_token_id TEXT UNIQUE REFERENCES oa_tokens(id),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX oa_sessions_operator ON oa_sessions(operator_id);
CREATE TABLE oa_external_identities (
 issuer TEXT NOT NULL, subject TEXT NOT NULL, operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 PRIMARY KEY(issuer, subject)
);
CREATE TABLE oa_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TRIGGER oa_preserve_last_owner_update BEFORE UPDATE OF status,role ON oa_operators
 WHEN OLD.role='owner' AND OLD.status='active' AND (NEW.role!='owner' OR NEW.status!='active')
 AND (SELECT COUNT(*) FROM oa_operators WHERE role='owner' AND status='active') <= 1
 BEGIN SELECT RAISE(ABORT, 'last_owner'); END;
CREATE TRIGGER oa_preserve_last_owner_delete BEFORE DELETE ON oa_operators
 WHEN OLD.role='owner' AND OLD.status='active'
 AND (SELECT COUNT(*) FROM oa_operators WHERE role='owner' AND status='active') <= 1
 BEGIN SELECT RAISE(ABORT, 'last_owner'); END;
-- A status/role change invalidates every preexisting session and link, including
-- after a later reactivation. Keep this invariant for direct administrative SQL.
CREATE TRIGGER oa_operator_version AFTER UPDATE OF status,role ON oa_operators
 WHEN OLD.status != NEW.status OR OLD.role != NEW.role
 BEGIN UPDATE oa_operators SET version=OLD.version+1 WHERE id=NEW.id; END;

-- Dial OPER-001: all admitted identities carry the same Base capability role.
-- Product identity rows remain the durable authorship/notification projection.
INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at)
 SELECT id,normalized_email,email,'owner',CASE WHEN removed_at IS NULL THEN 'active' ELSE 'inactive' END,
 access_generation + 1,CAST(unixepoch(created_at)*1000 AS INTEGER) FROM operators;
INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at)
 SELECT 1,operator_id,CAST(unixepoch(created_at)*1000 AS INTEGER) FROM operator_setup_identity;
-- Old session/link capabilities cannot cross the native Base protocol boundary.
UPDATE operator_sessions SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE magic_link_tokens SET consumed_at=COALESCE(consumed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TRIGGER dial_equal_operator_role_insert BEFORE INSERT ON oa_operators
 WHEN NEW.role != 'owner' BEGIN SELECT RAISE(ABORT,'dial_equal_operators'); END;
CREATE TRIGGER dial_equal_operator_role_update BEFORE UPDATE OF role ON oa_operators
 WHEN NEW.role != 'owner' BEGIN SELECT RAISE(ABORT,'dial_equal_operators'); END;
CREATE TRIGGER dial_base_operator_insert AFTER INSERT ON oa_operators BEGIN
 INSERT INTO operators(id,email,normalized_email,created_at,updated_at,removed_at)
 VALUES(NEW.id,NEW.email,NEW.email,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at/1000.0,'unixepoch'),
 strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status='active' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END);
 INSERT INTO operator_setup_identity(singleton_key,operator_id,created_at)
 SELECT 'default',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER dial_base_operator_status AFTER UPDATE OF status ON oa_operators
 WHEN OLD.status != NEW.status BEGIN
 UPDATE operators SET removed_at=CASE WHEN NEW.status='active' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
-- The immutable Base operator version invalidates sessions and tokens immediately.
-- Retain old tables solely as revoked migration history, never authenticate them.
