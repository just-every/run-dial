import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readArchive } from '@runeditrun/rer/modules/portability';
import { contract } from './contract.mjs';
import { checkout, run } from './archive/transfer.mjs';
import { quote } from '../scripts/archive/schema.mjs';

// A native backup the listed release (bb5d650f, migrations up to 0061) made of a
// populated install with two files, retained unchanged. Its owner-held salt is synthetic.
const fixture = new URL('./fixtures/archive/listed-bb5d650f.rer', import.meta.url);
const salt = 'synthetic-qualification-owner-salt';
const sorted = row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a < b ? -1 : 1)));
// 0063 turns invitee confirmations on for correspondence saved before the switch existed.
function confirmed(table, row) {
  if (!['event_correspondence', 'booking_correspondence'].includes(table)) return row;
  const templates = JSON.parse(row.templates_json);
  return { ...row, templates_json: JSON.stringify({ ...templates, inviteeConfirmationEnabled: templates.inviteeConfirmationEnabled ?? true }) };
}

contract('DATA-001', 'a backup made by the listed release restores through rer import with every archived value and file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dial-prior-backup-')), root = join(directory, 'install');
  let proxy;
  try {
    await checkout(root);
    const settings = await readFile(join(root, '.dev.vars'), 'utf8');
    await writeFile(join(root, '.dev.vars'), settings.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${salt}`), { mode: 0o600 });
    await copyFile(fixture, join(root, 'exports/prior.rer'));
    await run(root, ['import', '--target', 'local', '--input', 'exports/prior.rer', '--yes']);

    const records = []; for await (const record of readArchive(new Blob([await readFile(fixture)]).stream())) records.push(record);
    const [manifest] = records, items = records.filter(record => record.kind === 'part').flatMap(record => record.items);
    const { getPlatformProxy } = await import('wrangler');
    proxy = await getPlatformProxy({ configPath: join(root, 'wrangler.toml'), persist: { path: join(root, '.wrangler/state/v3') }, remoteBindings: false });
    const { DB, FILES } = proxy.env;
    let rows = 0;
    for (const table of manifest.tables) {
      const archived = table.columns.map(column => column.name);
      const columns = (await DB.prepare(`PRAGMA table_info(${quote(table.name)})`).all()).results.map(column => column.name);
      const expected = items.filter(item => item.kind === 'row' && item.table === table.name).map(item => sorted(confirmed(table.name, item.row))).sort();
      const actual = (await DB.prepare(`SELECT ${archived.map(quote).join(',')} FROM ${quote(table.name)}`).all()).results.map(sorted).sort();
      assert.deepEqual(actual, expected, `every archived value: ${table.name}`);
      // Columns added after the backup (0062) hold their default for restored rows.
      for (const column of columns.filter(name => !archived.includes(name))) {
        assert.equal((await DB.prepare(`SELECT count(*) AS n FROM ${quote(table.name)} WHERE ${quote(column)} IS NOT NULL`).first()).n, 0, `${table.name}.${column}`);
      }
      rows += expected.length;
    }
    assert.ok(rows > 60, 'the backup is populated');
    assert.equal(manifest.objects.length, 2);
    for (const object of manifest.objects) {
      const stored = await FILES.get(object.key); assert.ok(stored, object.key);
      const chunks = items.filter(item => item.kind === 'object' && item.key === object.key).sort((a, b) => a.offset - b.offset);
      assert.deepEqual(Buffer.from(await stored.arrayBuffer()), Buffer.concat(chunks.map(item => Buffer.from(item.data, 'base64'))), object.key);
      assert.equal(stored.httpMetadata.contentType, object.httpMetadata.contentType, object.key);
    }
    assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally {
    await proxy?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
