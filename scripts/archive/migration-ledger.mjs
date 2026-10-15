// Installer bookkeeping is not owner data, but its claims still have to agree
// with the exact SQL whose schema proof travels in the archive. Local Wrangler
// records names; hosted rer also records hashes and interrupted claims.
export async function assertMigrationLedger(db, migrations) {
 const expected = migrations.map(({ file, sha256 }) => ({ name: file.split('/').at(-1), sha256 }));
 const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('d1_migrations','_rer_deploy_migrations')").all()).results;
 for (const { name } of tables) {
  const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).results.map(row => row.name);
  const tracked = name === '_rer_deploy_migrations' || columns.includes('sha256') || columns.includes('state');
  if (tracked && (!columns.includes('sha256') || !columns.includes('state'))) throw Error('archive-migration-history-mismatch');
  const rows = (await db.prepare(`SELECT name${tracked ? ',sha256,state' : ''} FROM ${name} ORDER BY ${name === 'd1_migrations' ? 'id' : 'name'}`).all()).results;
  if (rows.length !== expected.length || rows.some((row, index) => row.name !== expected[index].name || tracked && (row.sha256 !== expected[index].sha256 || row.state !== 'applied'))) throw Error('archive-migration-history-mismatch');
 }
}
