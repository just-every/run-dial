import { all, statement, guard, quote, insist } from './storage.mjs';
import { canonicalJson } from './hash.mjs';

// Recovery requires a new installation, including excluded identity tables and
// normally replaceable product rows. Only SQLite/migration/transfer bookkeeping,
// the storage of FTS5 indexes and rows the destination's own migrations seed may
// already exist. Do not use the product's export exclusions for this check.
const bookkeeping=name=>/^(sqlite_|_cf_|rer_portability_)/i.test(name) || ['d1_migrations','_rer_deploy_migrations','_rer_portability_migrations'].includes(name.toLowerCase());
const fts5=/^\s*CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|'((?:[^']|'')+)'|([A-Za-z0-9_$]+))\s+USING\s+fts5\b/i;
const unquoted=m=>m[1]!==undefined?m[1].replaceAll('""','"'):m[4]!==undefined?m[4].replaceAll("''","'"):m[2]??m[3]??m[5];
// An FTS5 index keeps its data in <name>_data|idx|content|docsize|config. The index itself stays
// listed and is checked through its own SELECT, so a real indexed row still refuses.
function shadowTables(tables) {
 const shadows=new Set();
 for(const table of tables) {
  const match=fts5.exec(table.sql);
  if(match)for(const suffix of ['data','idx','content','docsize','config'])shadows.add(unquoted(match).toLowerCase()+'_'+suffix);
 }
 return shadows;
}
const imageSql=(table,columns)=>`SELECT json_array(${columns.map(c=>`quote(${quote(c)})`).join(',')}) AS image FROM ${quote(table)}`;
const MAX_SEED_ROWS=10000;

/** What the destination must still hold when the restore commits: `emptyTables` stay empty and
 * each of `seededTables` keeps exactly the rows its migrations put there. A table with rows the
 * replay of the destination's applied migrations (migrations(), a node runner's scratch database)
 * does not produce is listed as to-be-empty, so the preflight refuses it. */
export async function legacyTargetState(db,migrations) {
 const tables=await all(db,"SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name"),shadows=shadowTables(tables);
 const names=tables.map(t=>t.name).filter(name=>!bookkeeping(name) && !shadows.has(name.toLowerCase()));
 const filled=[];
 for(const name of names)if(await statement(db,`SELECT 1 FROM ${quote(name)} LIMIT 1`).first())filled.push(name);
 const seeded=[];
 if(filled.length && migrations) {
  const requests=[];
  for(const name of filled)requests.push({name,columns:(await all(db,`SELECT name FROM pragma_table_info(?)`,name)).map(c=>c.name)});
  // Without a usable replay no seed is vouched for, so those rows count as the installation's own.
  const expected=await migrations().then(replay=>replay.rowImages(requests,MAX_SEED_ROWS),()=>new Map());
  for(const {name,columns} of requests) {
   const want=expected.get(name);
   if(!want || (await statement(db,`SELECT count(*) AS n FROM ${quote(name)}`).first()).n!==want.length)continue;
   const found=(await all(db,imageSql(name,columns))).map(r=>r.image).sort();
   if(canonicalJson(found)===canonicalJson(want))seeded.push({name,columns,images:found});
  }
 }
 return {emptyTables:names.filter(name=>!seeded.some(s=>s.name===name)),seededTables:seeded};
}
const seededCondition=(db,table)=>[`(SELECT count(*) FROM ${quote(table.name)})=? AND NOT EXISTS(SELECT 1 FROM (${imageSql(table.name,table.columns)}) WHERE image NOT IN (SELECT value FROM json_each(?)))`,table.images.length,JSON.stringify(table.images)];
export async function requireLegacyEmpty({db,buckets},{emptyTables,seededTables=[]}) {
 for(const table of emptyTables)insist(!(await statement(db,`SELECT 1 FROM ${quote(table)} LIMIT 1`).first()),'legacy_target_not_empty:'+table,409);
 for(const table of seededTables){const [condition,...values]=seededCondition(db,table);insist((await statement(db,`SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END AS ok`,...values).first()).ok===1,'legacy_target_not_empty:'+table.name,409);}
 for(const [name,bucket] of Object.entries(buckets))insist(!(await bucket.list({limit:1})).objects.length,'legacy_bucket_not_empty:'+name,409);
}
export function legacyEmptyGuards(db,row) {
 const recovery=row.metadata.legacyRecovery;
 return [...(recovery?.emptyTables??[]).map(table=>guard(db,`NOT EXISTS(SELECT 1 FROM ${quote(table)})`)),
  ...(recovery?.seededTables??[]).map(table=>{const [condition,...values]=seededCondition(db,table);return guard(db,condition,...values);})];
}
export async function ensureLegacyAudit(db) {
 // Additive sidecar, installed only by recovery; existing product migrations
 // and transfer cleanup cannot remove the completed recovery audit.
 await db.prepare('CREATE TABLE IF NOT EXISTS rer_portability_recovery_audit (id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, details TEXT NOT NULL)').run();
}
export function legacyAuditStatements(db,row) {
 if(!row.metadata.legacyRecovery)return [];
 const {emptyTables,seededTables=[],...details}=row.metadata.legacyRecovery;
 return [statement(db,'INSERT INTO rer_portability_recovery_audit VALUES(?,?,?)',row.id,new Date().toISOString(),canonicalJson({...details,...(seededTables.length?{seededTables:seededTables.map(t=>t.name)}:{}),contentHash:row.metadata.contentHash,...(row.metadata.bridge?{bridged:row.metadata.bridge}:{})}))];
}
