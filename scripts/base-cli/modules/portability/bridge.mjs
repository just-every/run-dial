import { all, quote, insist } from './storage.mjs';
import { canonicalJson } from './hash.mjs';
import { tokens, identifier, folded } from './generated.mjs';
import { changesData } from './migration-statements.mjs';

// Applied product migrations in the ledger's own order: the deploy ledger when
// present (it covers any older Wrangler history), else Wrangler's.
export async function appliedMigrations(db) {
  const ledgers=(await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('_rer_deploy_migrations','d1_migrations')")).map(x=>x.name);
  if(ledgers.includes('_rer_deploy_migrations'))return (await all(db,"SELECT name FROM _rer_deploy_migrations WHERE state='applied' ORDER BY name")).map(x=>x.name);
  return ledgers.includes('d1_migrations')?(await all(db,'SELECT name FROM d1_migrations ORDER BY id')).map(x=>x.name):undefined;
}
// Where an archive sits in the destination's applied migrations: those its
// rows passed through (earlier) and those applied after it (unapplied).
// migrations() is the runner's replay of the destination's applied migrations
// (migration-history.mjs). The archive's schema must be the replay of the
// migrations it records or, for archives that predate that record, of an
// earlier prefix. Restored rows never pass through a later migration, so one
// that writes or rewrites restorable data is refused, whether or not it changes
// the schema.
async function placement(db,manifest,cat,replay,applied) {
  insist(canonicalJson(replay.names)===canonicalJson(applied) && await replay.schemaAfter(applied)===cat.identity,'schema_mismatch');
  let earlier,unapplied;
  if(manifest.migrations) {
    earlier=applied.filter(name=>manifest.migrations.includes(name));
    insist(await replay.schemaAfter(earlier)===manifest.schema,'schema_mismatch');
    unapplied=applied.filter(name=>!earlier.includes(name));
  }else{
    // Unrecorded: the latest matching prefix. Migrations that change no archived
    // table (indexes, excluded tables, data-only changes) cannot be told apart
    // and count as later. The source may have stopped at any matching prefix,
    // so every migration after the earliest one may be missing from its rows.
    const matching=[];
    for(let k=0;k<=applied.length;k++)if(await replay.schemaAfter(applied.slice(0,k))===manifest.schema)matching.push(k);
    insist(matching.length,'schema_mismatch');
    earlier=applied.slice(0,matching.at(-1));
    unapplied=applied.slice(matching[0]);
  }
  // Only rows the archive carries can skip a later migration's change. A table
  // the archive does not hold is restored empty, so triggers and backfills that
  // name only such tables (a newly added module's own) change no restored row.
  const restorable=cat.tables.map(t=>t.name).filter(name=>manifest.tables.some(t=>t.name===name));
  for(const name of unapplied)insist(!replay.statements(name).some(sql=>changesData(sql,restorable)),'schema_mismatch:migration_data:'+name);
  return {earlier};
}
// An archive with the destination's schema identity can still predate later
// migrations that changed only data (a purge or a backfill) or added an index.
// Those that change restorable data are refused like any other. Without a
// replayer the statements cannot be read, so an archive whose recorded
// migrations the destination's ledger has outgrown is refused.
export async function sameSchemaMigrations(db,manifest,cat,migrations) {
  const applied=await appliedMigrations(db);
  if(!applied)return;
  if(!migrations){insist(!manifest.migrations || applied.every(name=>manifest.migrations.includes(name)),'schema_mismatch:migrations');return;}
  await placement(db,manifest,cat,await migrations(),applied);
}
// An archive made before later migrations restores only when those migrations
// are additive: new tables, new columns that take a default, or indexes (which
// archives never carry). Anything else stays a schema_mismatch refusal.
export async function additiveBridge(db,manifest,cat,migrations) {
  insist(migrations,'schema_mismatch');
  const replay=await migrations(),applied=await appliedMigrations(db)??[];
  insist(!manifest.migrations || manifest.migrations.every(name=>applied.includes(name)),'schema_mismatch:migrations');
  const {earlier}=await placement(db,manifest,cat,replay,applied);
  const columns={};
  for(const table of manifest.tables) {
    const target=cat.tables.find(t=>t.name===table.name),label=':'+table.name;
    insist(target,'schema_mismatch:table'+label);
    const kept=target.columns.slice(0,table.columns.length),added=target.columns.slice(table.columns.length);
    insist(canonicalJson(kept)===canonicalJson(table.columns) && table.rowidAlias===target.rowidAlias && table.dependencies.every(d=>target.dependencies.includes(d)),'schema_mismatch:columns'+label);
    if(!added.length){insist(table.sql===target.sql,'schema_mismatch:definition'+label);continue;}
    const declared=await all(db,`PRAGMA table_xinfo(${quote(table.name)})`);
    insist(added.every(c=>!c.pk && !c.generated && (!c.notnull || declared.find(d=>d.name===c.name)?.dflt_value!=null)),'schema_mismatch:column_default'+label);
    insist(appended(table.sql,target.sql,added.map(c=>c.name)),'schema_mismatch:definition'+label);
    columns[table.name]=added.map(c=>c.name);
  }
  return {fromSchema:manifest.schema,toSchema:cat.identity,migrations:applied.filter(name=>!earlier.includes(name)),
    tables:cat.tables.filter(t=>!manifest.tables.some(x=>x.name===t.name)).map(t=>t.name),columns};
}
// The destination definition is the archived one with only the added column
// definitions inserted, as ALTER TABLE ADD COLUMN writes it: no other column,
// constraint or table option may differ.
function appended(before,after,names) {
  const a=tokens(before).map(t=>t.text),b=tokens(after),text=b.map(t=>t.text);
  let prefix=0,suffix=0;
  while(prefix<a.length && a[prefix]===text[prefix])prefix++;
  while(suffix<a.length && a[a.length-1-suffix]===text[text.length-1-suffix])suffix++;
  for(let k=Math.max(0,a.length-suffix);k<=prefix;k++) {
    const run=b.slice(k,k+text.length-a.length);
    if(run[0]?.text===',' && definitions(run.slice(1),names))return true;
  }
  return false;
}
function definitions(run,names) {
  const parts=[[]];let depth=0;
  for(const token of run) {
    if(token.text==='(')depth++;
    if(token.text===')' && --depth<0)return false;
    if(token.text===',' && !depth)parts.push([]);else parts.at(-1).push(token);
  }
  return !depth && parts.length===names.length && parts.every((part,i)=>part.length && folded(identifier(part[0]))===folded(names[i]));
}
