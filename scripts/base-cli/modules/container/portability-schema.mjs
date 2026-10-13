import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrate } from './migrations.mjs';
export async function portabilityPlan(split) {
 const sql = await readFile(new URL('../portability/schema/portability.sql', import.meta.url), 'utf8');
 return [{ name:'0001_portability.sql', sql, sha256:createHash('sha256').update(sql).digest('hex'), statements:split(sql) }];
}
// Existing product-owned bookkeeping remains under its original migrations.
// Independently installed bookkeeping cannot interleave later product migrations.
export async function ensurePortabilitySchema(db, plan) {
 const owned = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_rer_portability_migrations'").first();
 if (!owned && await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rer_portability_state'").first()) return;
 await migrate(db, plan, { ledger:'_rer_portability_migrations' });
}
