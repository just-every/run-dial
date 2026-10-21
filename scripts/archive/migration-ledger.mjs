// Installer bookkeeping is not owner data, but its claims still have to agree
// with the exact SQL whose schema proof travels in the archive. Local Wrangler
// records names; hosted rer also records hashes and interrupted claims; Platform
// records each completed file's name and hash in rer_migrations, and an
// interrupted Platform release leaves '<file>#<start>-<end>' progress rows.
const ledgers = { d1_migrations: 'id', _rer_deploy_migrations: 'name', rer_migrations: 'name' };
// The columns Platform's runner creates (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL).
const platformColumns = ['name', 'sha256', 'applied_at'];
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
  const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).results.map(row => row.name);
  const claims = name === '_rer_deploy_migrations' || name === 'd1_migrations' && (columns.includes('sha256') || columns.includes('state'));
  const fields = name === 'rer_migrations' ? platformColumns : claims ? ['name', 'sha256', 'state'] : ['name'];
  if (fields.some(field => !columns.includes(field))) throw Error('archive-migration-history-mismatch');
  const want = ledgers[name] === 'id' ? expected : byName;
  const rows = (await db.prepare(`SELECT ${fields.join(',')} FROM ${name} ORDER BY ${ledgers[name]}`).all()).results;
  if (rows.length !== want.length || rows.some((row, index) => row.name !== want[index].name || fields.includes('sha256') && row.sha256 !== want[index].sha256 || fields.includes('state') && row.state !== 'applied')) throw Error('archive-migration-history-mismatch');
 }
}
