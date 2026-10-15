import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploymentSpec } from '../delivery/base/spec.mjs';

const publishedPath = 'management/integration/deployment-spec.json';

/** Publish the same spec as the delivery artifact, from the actual Worker build. */
export async function publishDeploymentSpec({ root = process.cwd(), check = false } = {}) {
  const config = JSON.parse(await readFile(resolve(root, 'scripts/delivery/base/packaging.json'), 'utf8'));
  const spec = await deploymentSpec(root, config.artifact.specInputs);
  const bytes = `${JSON.stringify(spec, null, 2)}\n`;
  const destination = resolve(root, publishedPath);
  if (check) {
    if (await readFile(destination, 'utf8') !== bytes) {
      throw new Error('Deployment spec drift: run pnpm deployment-spec:generate after pnpm build');
    }
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return { ok: true, path: publishedPath, mode: check ? 'check' : 'generate' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['generate', 'check'].includes(mode) || extra.length) throw new Error('Usage: deployment-spec.mjs generate|check');
  console.log(JSON.stringify(await publishDeploymentSpec({ check: mode === 'check' })));
}
