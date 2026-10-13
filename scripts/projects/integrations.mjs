import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { packagingConfig } from '../delivery/base/package.mjs';
import { loadSetupManifest } from '../delivery/base/setup-manifest.mjs';

/** Structural source admission only: no setup, credentials, builds or network. */
export async function checkIntegrations(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const config = JSON.parse(await readFile(resolve(root, 'scripts/delivery/base/packaging.json'), 'utf8'));
  const { project, workflow, setup } = packagingConfig(config);
  const manifest = await loadSetupManifest(root, setup);
  if (!manifest) throw new Error('Canonical setup selection is required');
  const expected = { ...project, setup: { path: manifest.path, sha256: manifest.sha256 } };
  if (await readFile(resolve(root, 'rer-project.json'), 'utf8') !== JSON.stringify(expected, null, 2) + '\n') throw new Error('Regenerate the project descriptor from packaging policy and canonical setup');
  if (await readFile(resolve(root, '.github/workflows/rer-managed.yml'), 'utf8') !== workflow) throw new Error('Regenerate the managed workflow from packaging policy');
  return { ok: true, scope: 'source-structure-only', setup: manifest.path, unchecked: ['built artifact', 'hosted management acceptance', 'provider access', 'deployment'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== 'check') throw new Error('Usage: node scripts/projects/integrations.mjs check');
  console.log(JSON.stringify(await checkIntegrations(), null, 2));
}
