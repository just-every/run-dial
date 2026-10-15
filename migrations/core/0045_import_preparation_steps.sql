-- import-kit d1PreparationStepsSchema: control rows for preparations made across
-- requests (prepareD1ImportSteps). Erasure, cancellation and header retirement read it.
CREATE TABLE IF NOT EXISTS ik_d1_preparation_steps (id TEXT PRIMARY KEY, destination TEXT NOT NULL, namespace TEXT NOT NULL, mapping_version TEXT NOT NULL, principal_id TEXT NOT NULL, operation_key TEXT NOT NULL, reversal_policy TEXT NOT NULL, codec_id TEXT, source_digest TEXT NOT NULL, total INTEGER NOT NULL, records INTEGER NOT NULL DEFAULT 0, stages TEXT NOT NULL DEFAULT '[]', phase TEXT NOT NULL CHECK(phase IN ('collecting','hashing','combining','prepared')), hash_json TEXT, fingerprint TEXT, verified_revision INTEGER, revision INTEGER NOT NULL DEFAULT 0, UNIQUE(destination,principal_id,operation_key));

CREATE TRIGGER IF NOT EXISTS ik_d1_preparation_steps_binding BEFORE UPDATE OF id,destination,namespace,mapping_version,principal_id,operation_key,reversal_policy,codec_id,source_digest,total ON ik_d1_preparation_steps BEGIN SELECT RAISE(ABORT,'IMPORT_PREPARATION_BINDING_CHANGED'); END;

CREATE TRIGGER IF NOT EXISTS ik_d1_preparation_steps_revision BEFORE UPDATE ON ik_d1_preparation_steps WHEN NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'IMPORT_PREPARATION_CHANGED'); END;
