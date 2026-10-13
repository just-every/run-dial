import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkIntegrations } from '../scripts/projects/integrations.mjs';

test('managed source admission accepts canonical setup and refuses a changed installer manifest before build', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dial-source-admission-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['scripts/delivery/base/packaging.json', 'rer-project.json', 'rer-setup.json', '.github/workflows/rer-managed.yml']) await cp(path, join(directory, path), { recursive: true });
  assert.equal((await checkIntegrations(directory)).ok, true);
  const file = join(directory, 'rer-setup.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.title = 'Changed owner setup';
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  await assert.rejects(() => checkIntegrations(directory), /Regenerate the project descriptor/);
});
