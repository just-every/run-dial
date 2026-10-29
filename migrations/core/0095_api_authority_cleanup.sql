-- Replace automatic nulling with the explicit erasure batch, preserving host partitions.
CREATE TABLE api_hosts_next (
 id TEXT PRIMARY KEY NOT NULL,
 operator_id TEXT UNIQUE REFERENCES oa_operators(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
INSERT INTO api_hosts_next SELECT * FROM api_hosts;
CREATE TABLE api_event_hosts_next (
 event_type_id TEXT PRIMARY KEY NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES api_hosts_next(id)
);
INSERT INTO api_event_hosts_next SELECT * FROM api_event_hosts;
DROP TABLE api_event_hosts;
DROP TABLE api_hosts;
ALTER TABLE api_hosts_next RENAME TO api_hosts;
ALTER TABLE api_event_hosts_next RENAME TO api_event_hosts;
-- Base keeps active-session versioning and final-owner protection for all native roles.
