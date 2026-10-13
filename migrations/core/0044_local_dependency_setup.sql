-- Base accounts/schema/provider-control.sql: local dependency setup completion.
-- Existing owners start complete; a future first-owner bootstrap starts pending.
CREATE TABLE IF NOT EXISTS oa_auth_settings (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), idp_sign_in INTEGER NOT NULL CHECK(idp_sign_in IN (0,1)), generation INTEGER NOT NULL DEFAULT 0, first_setup INTEGER NOT NULL DEFAULT 0
);
INSERT INTO oa_auth_settings(singleton,idp_sign_in,generation,first_setup)
 SELECT 1,0,0,0 WHERE EXISTS(SELECT 1 FROM oa_bootstrap) ON CONFLICT DO NOTHING;
CREATE TRIGGER IF NOT EXISTS oa_first_setup_provider_setting AFTER INSERT ON oa_bootstrap BEGIN
 INSERT INTO oa_auth_settings(singleton,idp_sign_in,generation,first_setup) VALUES(1,0,0,1) ON CONFLICT DO NOTHING;
END;
