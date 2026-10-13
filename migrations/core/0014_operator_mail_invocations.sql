-- An unresolved admission is never made safe by its age. It survives Worker
-- restart so a lost provider outcome cannot cause an automatic second effect.
CREATE TABLE operator_mail_invocations (
  outbox_id TEXT NOT NULL REFERENCES delivery_outbox(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  provider_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('invoking', 'succeeded', 'failed')),
  provider_message_id TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (outbox_id, attempt_number)
);
CREATE INDEX operator_mail_invocations_key ON operator_mail_invocations(provider_key, state);
