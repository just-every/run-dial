-- Additive maintained Base import custody upgrade; applied history is unchanged.
CREATE TABLE IF NOT EXISTS ik_d1_reversal_fences (job_id TEXT PRIMARY KEY REFERENCES ik_jobs(id) ON DELETE CASCADE,action TEXT NOT NULL,fence INTEGER NOT NULL,state_revision INTEGER NOT NULL,erased_records INTEGER NOT NULL,reused INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ik_provenance_job ON ik_provenance(job_id,reversed,ordinal,effect_ordinal);
CREATE INDEX IF NOT EXISTS ik_provenance_source ON ik_provenance(source_identity,reversed);
CREATE INDEX IF NOT EXISTS ik_d1_history_source ON ik_d1_history(source_identity);
CREATE INDEX IF NOT EXISTS ik_sources_job ON ik_sources(job_id);
CREATE TABLE IF NOT EXISTS ik_d1_retirements (id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('job','stream')), destination TEXT NOT NULL, receipt_id TEXT NOT NULL, retired_at TEXT NOT NULL, PRIMARY KEY(id, kind));
CREATE TABLE IF NOT EXISTS ik_d1_erasure_journal (id TEXT PRIMARY KEY, destination TEXT NOT NULL, recorded_at TEXT NOT NULL, records_erased INTEGER NOT NULL CHECK(records_erased>=0), jobs_retired INTEGER NOT NULL CHECK(jobs_retired>=0), streams_retired INTEGER NOT NULL CHECK(streams_retired>=0), stores_json TEXT NOT NULL CHECK(json_valid(stores_json)));
CREATE INDEX IF NOT EXISTS ik_d1_erasure_journal_time ON ik_d1_erasure_journal(destination, recorded_at);
CREATE TRIGGER IF NOT EXISTS ik_d1_erasure_journal_insert BEFORE INSERT ON ik_d1_erasure_journal WHEN EXISTS(SELECT 1 FROM ik_d1_erasure_journal WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_JOURNAL_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_retirement_insert BEFORE INSERT ON ik_d1_retirements WHEN EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=NEW.id AND kind=NEW.kind) BEGIN SELECT RAISE(ABORT,'IMPORT_RETIREMENT_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_erasure_journal_update BEFORE UPDATE ON ik_d1_erasure_journal BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_JOURNAL_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_erasure_journal_delete BEFORE DELETE ON ik_d1_erasure_journal BEGIN SELECT RAISE(ABORT,'IMPORT_ERASURE_JOURNAL_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_retirement_update BEFORE UPDATE ON ik_d1_retirements BEGIN SELECT RAISE(ABORT,'IMPORT_RETIREMENT_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS ik_d1_retirement_delete BEFORE DELETE ON ik_d1_retirements BEGIN SELECT RAISE(ABORT,'IMPORT_RETIREMENT_CHANGED'); END;
CREATE TABLE IF NOT EXISTS ik_d1_erasure_tally (receipt_id TEXT NOT NULL, store TEXT NOT NULL, image TEXT NOT NULL);
DROP TRIGGER IF EXISTS ik_d1_stream_revision_update;
CREATE TRIGGER ik_d1_stream_revision_update BEFORE UPDATE ON ik_d1_stream_revisions WHEN NEW.stream_id IS NOT OLD.stream_id OR NEW.destination IS NOT OLD.destination OR NEW.mapping_version IS NOT OLD.mapping_version OR NEW.principal_id IS NOT OLD.principal_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.total IS NOT OLD.total OR NEW.layout_hash IS NOT OLD.layout_hash OR NEW.layout_revision<OLD.layout_revision OR NEW.progress_revision<=OLD.progress_revision OR ((NEW.namespace IS NOT OLD.namespace OR NEW.operation_key IS NOT OLD.operation_key) AND NOT (NEW.namespace='' AND NEW.operation_key='' AND NOT EXISTS(SELECT 1 FROM ik_d1_streams WHERE id=OLD.stream_id) AND EXISTS(SELECT 1 FROM ik_d1_retirements WHERE id=OLD.stream_id AND kind='stream'))) BEGIN SELECT RAISE(ABORT,'IMPORT_STREAM_REVISION_CHANGED'); END;
