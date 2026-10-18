import { assert } from './validation.mjs';

export const ledger = 'd1_migrations';
const legacy = '_rer_deploy_migrations';
export const literal = value => `'${value.replaceAll("'","''")}'`;
export const createLedger = `CREATE TABLE ${ledger} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sha256 TEXT, state TEXT CHECK(state IN ('applying','applied')))`;

// Every ledger shape a deployment can hold: Wrangler's d1_migrations; that
// table after the kit adopted it (sha256 and state added); the kit's own
// d1_migrations, which rer 0.2.2 and later create; and the kit's
// _rer_deploy_migrations from rer 0.2.1 and earlier, which stays authoritative
// until the next deploy moves it into d1_migrations. Seed recovery code that
// checks the ledger before reading or restoring it accepts all four with
// migrationLedgerShape.
const shapeColumns = table => `SELECT '${table}' AS ledger,cid,name,upper(type) AS type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo('${table}')`;
export const ledgerShapeQuery = `${shapeColumns(legacy)} UNION ALL ${shapeColumns(ledger)} ORDER BY ledger,cid`;
const column = (name, type, notnull = 0, dflt_value = null, pk = 0) => ({ name, type, notnull, dflt_value, pk, hidden: 0 });
const wrangler = [column('id','INTEGER',0,null,1), column('name','TEXT'), column('applied_at','TIMESTAMP',1,'CURRENT_TIMESTAMP')];
const tracked = [column('sha256','TEXT'), column('state','TEXT')];
const shapes = {
  [ledger]: {
    wrangler,
    adopted: [...wrangler, ...tracked],
    kit: [column('id','INTEGER',0,null,1), column('name','TEXT',1), column('applied_at','TEXT',1,'CURRENT_TIMESTAMP'), ...tracked],
  },
  [legacy]: { legacy: [column('name','TEXT',0,null,1), column('sha256','TEXT',1), column('state','TEXT',1)] },
};
/** The ledger's shape from its ledgerShapeQuery rows (node:sqlite or D1):
 * { name, columns, shape } where shape is 'wrangler', 'adopted', 'kit' or
 * 'legacy'. When both tables exist, _rer_deploy_migrations is the history, as
 * restores read it. Any other shape throws invalid-migration-ledger. */
export function migrationLedgerShape(rows) {
  // Rows without a ledger column come from the d1_migrations-only query of rer 0.2.3.
  const tables = Map.groupBy(rows ?? [], row => row.ledger ?? ledger);
  const name = tables.has(legacy) ? legacy : ledger;
  const read = (tables.get(name) ?? []).map(row => ({ name: row.name, type: String(row.type).toUpperCase(), notnull: Number(row.notnull), dflt_value: row.dflt_value ?? null, pk: Number(row.pk), hidden: Number(row.hidden) }));
  const shape = Object.keys(shapes[name]).find(key => JSON.stringify(read) === JSON.stringify(shapes[name][key]));
  assert(shape, 'invalid-migration-ledger');
  return { name, columns: read.map(row => row.name), shape };
}
/** An applied row records this migration: its current bytes, or bytes a seed's
 * reviewed rewrite record says this migration replaced. */
export const recorded = (row, migration) => row.name === migration?.name && (row.sha256 === migration.sha256 || (migration.rewrites ?? []).some(rewrite => rewrite.from === row.sha256));
/** Applied history this build records, by name: every row is applied, names a
 * build migration once, and holds that migration's recorded bytes. Rows may skip
 * build migrations: a seed release can add migrations that sort below ones an
 * install already applied, and Wrangler applies those by name set too. */
const validHistory = (rows, migrations) => {
  const byName = new Map(migrations.map(migration => [migration.name, migration])), seen = new Set();
  return rows.every(row => row.state === 'applied' && !seen.has(row.name) && seen.add(row.name) && recorded(row, byName.get(row.name)));
};
/** The build migrations these rows do not apply, in name order. */
export const unapplied = (rows, migrations) => {
  const names = new Set(rows.map(row => row.name));
  return migrations.filter(migration => !names.has(migration.name));
};
const same = (a, b) => a.length === b.length && a.every((row, index) => row.name === b[index].name && row.sha256 === b[index].sha256 && row.state === b[index].state);

/** History this build does not match. When it ends in an unconfirmed claim after
 * valid history, the error names that claim (`unconfirmedClaim`) so the refusal can
 * give the exact command that clears it; `rewritten` says a reviewed rewrite
 * replaced the claimed bytes and only a deploy holding the install's lock retries it. */
function unmatched(rows, migrations) {
  const error = new Error('changed-or-uncertain-migration-history'), last = rows.at(-1);
  if (last?.state === 'applying' && /^[a-f0-9]{64}$/.test(last.sha256 ?? '') && validHistory(rows.slice(0, -1), migrations)) {
    const next = unapplied(rows.slice(0, -1), migrations)[0];
    error.unconfirmedClaim = { name:last.name, sha256:last.sha256, rewritten:last.name === next?.name && (next.rewrites ?? []).some(rewrite => rewrite.from === last.sha256) };
  }
  return error;
}

/** `rewritten`: the caller holds the install's deploy lock (owner.mjs withStateLock),
 * so no other deploy of it is running; a claim on bytes a reviewed rewrite replaced
 * is then this build's to retry. */
export async function readLedger(api, id, migrations, query, { rewritten = false } = {}) {
  const read = async sql => (await query(api, id, sql))[0].results;
  const tables = (await read(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${legacy}','${ledger}')`)).map(row => row.name);
  let old = [], applied = [], transition = '', claimed = false, claimedFrom;
  if (tables.includes(legacy)) {
    const columns = await read(`SELECT name FROM pragma_table_info('${legacy}')`);
    assert(columns.length === 3 && columns.every(row => ['name','sha256','state'].includes(row.name)), 'invalid-migration-ledger');
    old = await read(`SELECT name, sha256, state FROM ${legacy} ORDER BY name`);
    assert(validHistory(old, migrations), 'changed-or-uncertain-migration-history');
  }
  if (tables.includes(ledger)) {
    const columns = (await read(`SELECT name FROM pragma_table_info('${ledger}')`)).map(row => row.name);
    assert(['id','name','applied_at'].every(name => columns.includes(name)), 'invalid-migration-ledger');
    if (columns.includes('sha256') && columns.includes('state')) {
      applied = await read(`SELECT name, sha256, state FROM ${ledger} ORDER BY id`);
      // The last row may claim this build's next migration (its first unapplied one,
      // as migrate claims them) whose import did not complete: its exact bytes, or
      // (`rewritten`) bytes a reviewed rewrite replaced. migrate re-runs it only on
      // proof (migration-retry.mjs).
      const last = applied.at(-1), next = unapplied(applied.slice(0, -1), migrations)[0];
      if (!tables.includes(legacy) && last?.state === 'applying' && last.name === next?.name) {
        if (last.sha256 === next.sha256) claimed = Boolean(applied.pop());
        else if (rewritten && (next.rewrites ?? []).some(rewrite => rewrite.from === last.sha256)) { claimedFrom = last.sha256; claimed = Boolean(applied.pop()); }
      }
      if (!validHistory(applied, migrations)) throw unmatched(applied, migrations);
      if (tables.includes(legacy)) assert(same(applied, old), 'changed-or-uncertain-migration-history');
    } else {
      assert(!columns.includes('sha256') && !columns.includes('state'), 'invalid-migration-ledger');
      const prior = await read(`SELECT name FROM ${ledger} ORDER BY id`);
      // Names alone cannot attest historical bytes. Only an already verified kit
      // prefix can supply hashes; preserve Wrangler row IDs and timestamps.
      assert(prior.length <= old.length && prior.every((row,index) => row.name === old[index].name), 'legacy-migration-history-needs-reviewed-hash-adoption');
      transition += `ALTER TABLE ${ledger} ADD COLUMN sha256 TEXT;\nALTER TABLE ${ledger} ADD COLUMN state TEXT;\n`;
      for (const row of old.slice(0,prior.length)) transition += `UPDATE ${ledger} SET sha256=${literal(row.sha256)}, state='applied' WHERE name=${literal(row.name)};\n`;
      for (const row of old.slice(prior.length)) transition += insert(row);
      applied = old;
    }
  } else if (tables.includes(legacy)) {
    transition = `${createLedger};\n`;
    for (const row of old) transition += insert(row);
    applied = old;
  }
  if (tables.includes(legacy)) transition += `DROP TABLE ${legacy};`;
  return { applied, pending:unapplied(applied, migrations), transition, claimed, claimedFrom, exists:tables.includes(ledger) || tables.includes(legacy) };
}
function insert(row) {
  return `INSERT INTO ${ledger}(name,sha256,state) VALUES (${literal(row.name)},${literal(row.sha256)},'applied');\n`;
}
