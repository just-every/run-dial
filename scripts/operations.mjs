import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from '@runeditrun/rer/operations';

// Compatibility entrypoint required by operations review; Base owns command delegation.
export { main };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch {
    if (process.argv.slice(2).length === 1 && process.argv[2] === 'check') console.error('Operations check failed: descriptor or local configuration is invalid or unreadable; details are suppressed. Read OPERATIONS.md, then run pnpm exec rer doctor or describe.');
    console.error(JSON.stringify({ ok: false, error: 'Invalid command or unreadable operations files. Usage: node scripts/operations.mjs describe|check' }));
    process.exitCode = 1;
  }
}
