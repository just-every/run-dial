import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Everything a local installation's D1 persists: the schema catalogue and every readable table's rows,
// application, ledger and portability tables alike. Equal results mean a command wrote nothing.
// D1's own _cf_METADATA counter is the one table left out of the rows: the runtime bumps it on any binding access, reads included.
export async function storageState(root) {
  const directory = join(root, '.wrangler/state/v3/d1');
  const files = (await readdir(directory, { withFileTypes: true, recursive: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite')
    .map(entry => join(entry.parentPath, entry.name)).sort();
  return files.map(file => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const catalogue = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
      const rows = Object.fromEntries(catalogue.filter(({ type, name }) => type === 'table' && name !== '_cf_METADATA').map(({ name }) => [name,
        db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(Object.entries(row).sort(), (key, value) => typeof value === 'bigint' ? String(value) : value)).sort()]));
      return { catalogue, rows };
    } finally { db.close(); }
  });
}
