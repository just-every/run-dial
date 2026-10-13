import { all, statement, guard, quote, insist } from './storage.mjs';
import { canonicalJson } from './hash.mjs';

// Recovery requires a new installation, including excluded identity tables and
// normally replaceable product rows. Only SQLite/migration/transfer bookkeeping
// may already exist. Do not use the product's export exclusions for this check.
export async function legacyEmptyTables(db) {
 const tables=await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name");
 return tables.map(t=>t.name).filter(name=>!(/^(sqlite_|_cf_|rer_portability_)/i.test(name) || ['d1_migrations','_rer_deploy_migrations','_rer_portability_migrations'].includes(name.toLowerCase())));
}
export async function requireLegacyEmpty({db,buckets},tables) {
 for(const table of tables)insist(!(await statement(db,`SELECT 1 FROM ${quote(table)} LIMIT 1`).first()),'legacy_target_not_empty:'+table,409);
 for(const [name,bucket] of Object.entries(buckets))insist(!(await bucket.list({limit:1})).objects.length,'legacy_bucket_not_empty:'+name,409);
}
export function legacyEmptyGuards(db,row) {
 return (row.metadata.legacyRecovery?.emptyTables??[]).map(table=>guard(db,`NOT EXISTS(SELECT 1 FROM ${quote(table)})`));
}
export async function ensureLegacyAudit(db) {
 // Additive sidecar, installed only by recovery; existing product migrations
 // and transfer cleanup cannot remove the completed recovery audit.
 await db.prepare('CREATE TABLE IF NOT EXISTS rer_portability_recovery_audit (id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, details TEXT NOT NULL)').run();
}
export function legacyAuditStatements(db,row) {
 if(!row.metadata.legacyRecovery)return [];
 const {emptyTables,...details}=row.metadata.legacyRecovery;
 return [statement(db,'INSERT INTO rer_portability_recovery_audit VALUES(?,?,?)',row.id,new Date().toISOString(),canonicalJson({...details,contentHash:row.metadata.contentHash}))];
}
