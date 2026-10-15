-- import-kit d1PreparationStepsSchema addition: a stream published by
-- prepareD1ImportSteps keeps the source digest its steps began with, so only
-- that same upload replays as published under its operation key.
CREATE TABLE IF NOT EXISTS ik_d1_stream_sources (stream_id TEXT PRIMARY KEY REFERENCES ik_d1_streams(id) ON DELETE CASCADE, destination TEXT NOT NULL, source_digest TEXT NOT NULL);
