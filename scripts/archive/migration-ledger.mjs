// Installer bookkeeping is not owner data, but its claims still have to agree
// with the exact SQL whose schema proof travels in the archive. Local Wrangler
// records names; hosted rer also records hashes and interrupted claims; Platform
// records each completed file's name and hash in rer_migrations, and an
// interrupted Platform release leaves '<file>#<start>-<end>' progress rows.
const ledgers = { d1_migrations: 'id', _rer_deploy_migrations: 'name', rer_migrations: 'name' };
export async function assertMigrationLedger(db, migrations) {
 const expected = migrations.map(({ file, sha256 }) => ({ name: file.split('/').at(-1), sha256 }));
 const byName = [...expected].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
 const tables = (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${Object.keys(ledgers).map(name => `'${name}'`).join(',')})`).all()).results;
 for (const { name } of tables) {
  const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).results.map(row => row.name);
  const claims = name === '_rer_deploy_migrations' || name === 'd1_migrations' && (columns.includes('sha256') || columns.includes('state'));
  const fields = name === 'rer_migrations' ? ['name', 'sha256'] : claims ? ['name', 'sha256', 'state'] : ['name'];
  if (fields.some(field => !columns.includes(field))) throw Error('archive-migration-history-mismatch');
  const want = ledgers[name] === 'id' ? expected : byName;
  const rows = (await db.prepare(`SELECT ${fields.join(',')} FROM ${name} ORDER BY ${ledgers[name]}`).all()).results;
  if (rows.length !== want.length || rows.some((row, index) => row.name !== want[index].name || fields.includes('sha256') && row.sha256 !== want[index].sha256 || fields.includes('state') && row.state !== 'applied')) throw Error('archive-migration-history-mismatch');
 }
}
