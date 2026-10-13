import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { createArchive } from './archive/artifact.mjs';
import { restoreArchive } from './archive/artifact.mjs';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';

const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare } = await import(pathToFileURL(require.resolve('miniflare')));

contract('DATA-001', 'native restored branded templates cannot dispatch or refresh after restaging; newly authorized mail still freezes current facts', async () => {
  const source = await fixture();
  const state = await mkdtemp(join(tmpdir(), 'dial-mail-archive-'));
  let worker;
  try {
    const original = source.db.prepare('SELECT * FROM delivery_outbox').get();
    const payload = { ...JSON.parse(original.payload_json), mailTemplate: { kind: 'booking-cancellation', hostName: 'Historical host', actor: 'Google Calendar', reason: 'deleted_in_google_calendar' } };
    source.db.prepare('UPDATE delivery_outbox SET payload_json=?').run(JSON.stringify(payload));
    for (const kind of ['calendar_upsert', 'calendar_cancel', 'reminder']) {
      source.db.prepare('INSERT INTO delivery_outbox (id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?,?)')
        .run(`historical-${kind}`, kind, `historical-${kind}`, original.booking_id, original.occurrence_id, JSON.stringify(payload), 'pending', original.next_attempt_at, original.created_at, original.updated_at);
    }
    const archive = await createArchive(testPlatform(source.db));
    const compiled = await build({ entryPoints: [fileURLToPath(new URL('./archive/mail-worker.mjs', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], write: false });
    worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{ config: {
      type: 'worker', name: 'mail-archive', compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
      env: { DB: { type: 'd1', id: 'mail-archive' } },
      manifest: { mainModule: 'worker.mjs', modulesRoot: state, modules: { 'worker.mjs': { type: 'esm', contents: compiled.outputFiles[0].text } } },
    } }] });
    const db = await worker.getD1Database('DB');
    for (const directory of ['core', 'ext']) {
      const path = new URL(`../migrations/${directory}/`, import.meta.url);
      const files = await readdir(path).catch(error => { if (directory === 'ext' && error.code === 'ENOENT') return []; throw error; });
      for (const name of files.filter(file => file.endsWith('.sql')).sort()) {
        // D1 exec splits on newlines; prepared statements accept whole triggers.
        const sql = await readFile(new URL(name, path), 'utf8');
        await db.batch(splitSqlQuery(sql).map(statement => db.prepare(statement)));
      }
    }
    const platform = { binding: db, objects: new Map(),
      query: async (sql, params = []) => (await db.prepare(sql).bind(...params).all()).results,
      batch: async statements => (await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)))).map(result => result.results),
      listObjects: async () => [],
      async putObject() { throw new Error('Fixture unexpectedly contains an object'); },
    };
    await restoreArchive(platform, archive);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM booking_manage_tokens').first()).n, 0);
    const payloads = (await db.prepare('SELECT payload_json FROM delivery_outbox').all()).results.map(row => JSON.parse(row.payload_json));
    assert.ok(payloads.every(row => row.archiveHistorical && row.mailTemplate && !row.wireMail && !row.html && !row.text && !row.manageUrl));
    for (const state of ['failed', 'pending', 'processing', 'succeeded']) {
      await db.prepare('UPDATE delivery_outbox SET state=?').bind(state).run();
      const response = await worker.dispatchFetch('https://archive.test/historical');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { due: { attempted: 0, succeeded: 0 }, direct: Array(4).fill('not_due'), retries: Array(4).fill(null), unchanged: true, sent: 0, calendarCalls: 0 });
    }
    const response = await worker.dispatchFetch('https://archive.test/fresh');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: ['succeeded', 'succeeded'], sent: 2, calendarCalls: 0, frozenExact: true, branded: true, currentActions: true, creationDuration: 30 });
  } finally {
    source.db.close();
    try { await worker?.dispose(); }
    finally { await rm(state, { recursive: true, force: true }); }
  }
});
