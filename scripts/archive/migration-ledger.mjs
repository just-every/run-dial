// Installer bookkeeping is not owner data, but its claims still have to agree
// with the exact SQL whose schema proof travels in the archive. Local Wrangler
// records names; hosted rer also records hashes and interrupted claims; Platform
// records each completed file's name and hash in rer_migrations, and an
// interrupted Platform release leaves '<file>#<start>-<end>' progress rows.
// Each ledger is read in the order the pinned rer consumes it: Platform inserts a
// file's row in the same request as its SQL, so rer replays rer_migrations by
// rowid (modules/portability/ledgers.mjs) and that must be the spec's order.
const ledgers = { d1_migrations: 'id', _rer_deploy_migrations: 'name', rer_migrations: 'rowid' };
// Mirror @runeditrun/rer 0.2.77 modules/portability/ledgers.mjs's private
// platformShape: exact inventory/order, declared type, nullability and primary key.
const platformShape = [
 { name: 'name', type: 'TEXT', notnull: 0, pk: 1 },
 { name: 'sha256', type: 'TEXT', notnull: 1, pk: 0 },
 { name: 'applied_at', type: 'TEXT', notnull: 1, pk: 0 },
];
const platformColumns = platformShape.map(column => column.name);
const ledgerTables = async db => (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${Object.keys(ledgers).map(name => `'${name}'`).join(',')})`).all()).results;
// Wrangler cannot read rer_migrations, so it would apply every file again to a
// database Platform migrated: Platform's runner stays its only migration
// authority. Such a database holds that ledger alone, with every file of this
// revision completed by its hash. True for it, false for any other database.
// The whole accepted history is checked here, before anything writes to the
// database, so a malformed Platform ledger is refused with storage unchanged.
export async function platformLedger(db, migrations) {
 const tables = (await ledgerTables(db)).map(row => row.name);
 if (!tables.includes('rer_migrations')) return false;
 if (tables.length > 1) throw Error('migration_ledger:multiple:rer_migrations');
 const applied = new Set((await db.prepare("SELECT sha256 FROM rer_migrations WHERE instr(name,'#')=0").all()).results.map(row => row.sha256));
 const pending = migrations.find(({ sha256 }) => !applied.has(sha256));
 if (pending) throw Error('migration_ledger:unapplied:' + pending.file.split('/').at(-1));
 try { await assertMigrationLedger(db, migrations); }
 catch (error) { throw error.message === 'archive-migration-history-mismatch' ? Error('migration_ledger:schema_mismatch:rer_migrations') : error; }
 return true;
}
export async function assertMigrationLedger(db, migrations) {
 const expected = migrations.map(({ file, sha256 }) => ({ name: file.split('/').at(-1), sha256 }));
 const byName = [...expected].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
 for (const { name } of await ledgerTables(db)) {
  const structure = (await db.prepare(`PRAGMA table_info(${name})`).all()).results;
  if (name === 'rer_migrations' && (structure.length !== platformShape.length || structure.some((column, index) =>
   Object.entries(platformShape[index]).some(([key, value]) => column[key] !== value)))) throw Error('archive-migration-history-mismatch');
  const columns = structure.map(row => row.name);
  const claims = name === '_rer_deploy_migrations' || name === 'd1_migrations' && (columns.includes('sha256') || columns.includes('state'));
  const fields = name === 'rer_migrations' ? platformColumns : claims ? ['name', 'sha256', 'state'] : ['name'];
  if (fields.some(field => !columns.includes(field))) throw Error('archive-migration-history-mismatch');
  const want = ledgers[name] === 'name' ? byName : expected;
  const rows = (await db.prepare(`SELECT ${fields.join(',')} FROM ${name} ORDER BY ${ledgers[name]}`).all()).results;
  if (name === 'rer_migrations' && rows.some(row => row.applied_at === null)) throw Error('archive-migration-history-mismatch');
  if (rows.length !== want.length || rows.some((row, index) => row.name !== want[index].name || fields.includes('sha256') && row.sha256 !== want[index].sha256 || fields.includes('state') && row.state !== 'applied')) throw Error('archive-migration-history-mismatch');
 }
}
