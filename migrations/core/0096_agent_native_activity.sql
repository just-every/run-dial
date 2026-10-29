CREATE TABLE agent_native_activity (
  operation_id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  sponsor_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  approvers TEXT NOT NULL,
  happened_at TEXT NOT NULL
);
