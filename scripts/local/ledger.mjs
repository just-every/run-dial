import { resolve } from 'node:path';
import { platformLedger } from '../archive/migration-ledger.mjs';
import { migrationFiles } from '../archive/schema.mjs';
// Which runner migrates this installation's database, read before any step
// writes to it. Prints one receipt: {ok, platform}, or {ok: false, refused}
// naming why Platform's ledger cannot vouch for this revision's migrations.
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy({ configPath: resolve('wrangler.toml'), persist: { path: resolve('.wrangler/state/v3') }, remoteBindings: false });
let receipt;
try { receipt = { ok: true, platform: await platformLedger(proxy.env.DB, await migrationFiles()) }; }
catch (error) { if (!/^migration_ledger:/.test(error.message)) throw error; receipt = { ok: false, refused: error.message }; }
finally { await proxy.dispose(); }
console.log(JSON.stringify(receipt));
