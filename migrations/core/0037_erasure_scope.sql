ALTER TABLE rer_erasure_guard ADD COLUMN scope INTEGER NOT NULL DEFAULT 1 CONSTRAINT erasure_scope_changed CHECK(scope=1);
ALTER TABLE rer_erasure_guard ADD COLUMN retained INTEGER NOT NULL DEFAULT 1 CONSTRAINT erasure_retained_missing CHECK(retained=1);
CREATE TABLE rer_erasure_scope (
  operation TEXT NOT NULL, kind TEXT NOT NULL, table_name TEXT NOT NULL, key_json TEXT NOT NULL, row_json TEXT NOT NULL,
  PRIMARY KEY(operation,kind,table_name,key_json,row_json)
);
