import { rerEntry, rerArguments } from '../rer-command.mjs';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { environment } from '../local-setup/runtime.mjs';
import { archiveDiagnostic } from './command-diagnostics.mjs';

export const setupToken = 'synthetic-import-setup-token-at-least-32';
export async function checkout(root) {
  await mkdir(root, { recursive: true });
  // The current source installation has no static public directory. Its native
  // CLI discovers the adapter and setup model through the operations descriptor.
  for (const name of ['scripts', 'migrations', 'modules', 'foundation', 'agent-surface.json', 'deploy', 'src', 'package.json', 'pnpm-lock.yaml', 'OPERATIONS.json', 'OPERATIONS.md', 'ACCEPTANCE.md', 'seed.json', 'edition.json', 'rer-project.json', 'rer-setup.json', 'deploy.json', 'CONTRACT.md', 'BASELINE.md', 'RELEASE.json', 'tsconfig.json', 'vite.config.ts']) {
    await cp(resolve(name), join(root, name), { recursive: true });
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  // Transfer into an empty install requires owner-held settings, not setup:
  // setup would already claim an owner and correctly make import refuse it.
  await writeFile(join(root, '.dev.vars'), [
    'ENVIRONMENT=development', 'APP_URL=http://127.0.0.1', 'OWNER_EMAIL=operator@example.test',
    'MAIL_PROVIDER=development', 'MAIL_FROM=noreply@example.test',
    'SESSION_SECRET=synthetic-import-session-secret-at-least-32', `SETUP_TOKEN=${setupToken}`,
  ].join('\n') + '\n', { mode: 0o600 });
  await mkdir(join(root, 'exports'), { mode: 0o700 });
}

export async function run(root, args) {
  let output = '', failed = false, cleanupFailed = false;
  const owned = spawnOwned(process.execPath, rerArguments([rerEntry, ...args, '--non-interactive', '--json']),
    { cwd: root, env: environment() }, { label: 'archive CLI', onOutput: chunk => { output += chunk; } });
  try { await owned.waitForClose(180_000); }
  catch { failed = true; }
  finally {
    try { await owned.stop(); }
    catch { cleanupFailed = true; }
  }
  if (failed || cleanupFailed) throw new Error(`Native archive CLI failed: ${JSON.stringify(archiveDiagnostic(output, args[0], owned.state, cleanupFailed ? 'cleanup' : 'command'))}`);
}
