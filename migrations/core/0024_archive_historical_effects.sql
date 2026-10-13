-- Additive archive authority markers; preserve every existing diagnostic fact.
-- Existing installations keep their live work (default 0). Export sets 1 only
-- on retained historical probes/cleanup targets, independent of source state.
ALTER TABLE calendar_deletion_probes
  ADD COLUMN archive_historical INTEGER NOT NULL DEFAULT 0 CHECK (archive_historical IN (0, 1));
ALTER TABLE erased_calendar_targets
  ADD COLUMN archive_historical INTEGER NOT NULL DEFAULT 0 CHECK (archive_historical IN (0, 1));
