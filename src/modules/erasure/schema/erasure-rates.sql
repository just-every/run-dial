CREATE TABLE rer_erasure_rates (
  rate_table TEXT NOT NULL, rate_key TEXT NOT NULL, entity TEXT NOT NULL, subject TEXT NOT NULL,
  PRIMARY KEY(rate_table, rate_key, entity, subject)
);
CREATE INDEX rer_erasure_rates_subject ON rer_erasure_rates(entity, subject);
