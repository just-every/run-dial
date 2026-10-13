#!/usr/bin/env node
import { main } from './base-cli/cli/main.mjs';
import { parse } from './base-cli/cli/parse.mjs';
import { output } from './base-cli/cli/output.mjs';
import { refuse } from './base-cli/cli/errors.mjs';
import { assertLegacyStateRecovered } from './local/legacy-state.mjs';

// Base owns parsing and reset. Dial's retired executors used additional private
// storage locations, which must be recovered before Base can remove local data.
let options;
try { options = parse(process.argv.slice(2)); } catch { /* main reports invalid invocations. */ }
let refused = false;
if (options?.verb === 'reset' && !options.help) {
 try { await assertLegacyStateRecovered(options.cwd); }
 catch {
  const out = output(options), error = refuse('Legacy Dial build/setup storage remains or cannot be inspected. Stop the old runtime and recover its original .dev.vars and data before removing the empty legacy directory; no data was changed.');
  out.error(error); out.result(false, error.exitCode); process.exitCode = error.exitCode; refused = true;
 }
}
if (!refused) process.exitCode = await main();
