-- Source admission is durable across isolates. Writer receipts never expire:
-- a crashed writer refuses export, while ordinary use can continue. A hosted
-- export lease expires so an abandoned client cannot hold the app in maintenance.
CREATE TABLE dial_portability_admission (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('writer','export')),
 expires_at INTEGER,
 CHECK ((kind='writer' AND expires_at IS NULL) OR (kind='export' AND expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX dial_portability_one_export ON dial_portability_admission(kind) WHERE kind='export';
