-- DATA-002: authentication counters written before 0038 carry no rer_erasure_rates
-- correlation, so an erased operator's confirmation counter could not be found.
-- Rate windows are ephemeral admission state (never archived): retire every
-- pre-correlation row once; later writes for a known operator are correlated.
DELETE FROM oa_limits;
