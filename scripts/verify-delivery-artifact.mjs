import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { produceSeedArtifact } from './delivery/base/package.mjs';
import { checkIntegrations } from './projects/integrations.mjs';

const root = process.cwd();
const config = JSON.parse(await readFile('scripts/delivery/base/packaging.json', 'utf8'));
await checkIntegrations(root);
const directory = await mkdtemp(join(root, '.delivery-check-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const path = await produceSeedArtifact({ root, config, output: relative(root, join(directory, 'artifact/rer-worker-artifact.json')) });
  const artifact = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(artifact.schema, 2);
  const spec = artifact.deploymentSpec;
  assert.equal(spec.publicVariables.ENVIRONMENT, 'production', 'credential-free build carries the native runtime deployment mode');
  for (const [kind, binding] of [['d1', 'DB'], ['r2', 'FILES'], ['queue', 'JOBS'], ['queue', 'JOBS_DEAD']]) {
    assert.ok(spec.resources.some(resource => resource.kind === kind && resource.binding === binding));
  }
  assert.ok(spec.durableObjects.some(item => item.binding === 'BOOKING_COORDINATOR' && item.className === 'BookingCoordinator'));
  assert.ok(spec.queueConsumers.some(item => item.binding === 'JOBS' && item.deadLetterBinding === 'JOBS_DEAD'));
  const migrations = (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(spec.migrations.map(item => item.name), migrations);
  for (const migration of spec.migrations) {
    const source = await readFile(join('migrations/core', migration.name));
    assert.equal(migration.binding, 'DB'); assert.equal(migration.sql, source.toString('utf8')); assert.equal(migration.sha256, sha256(source));
  }
  for (const [items, sourceDirectory] of [[artifact.modules, 'dist/server'], [artifact.assets, 'dist/client']]) {
    assert.ok(items.length > 0);
    for (const item of items) {
      const bytes = await readFile(join(directory, 'artifact', item.payload));
      const original = await readFile(join(sourceDirectory, item.name ?? item.path.replace(/^\//, '')));
      assert.deepEqual(bytes, original); assert.equal(item.size, bytes.length); assert.equal(item.sha256, sha256(bytes));
    }
  }
  assert.ok(artifact.modules.some(item => item.name === artifact.mainModule));
  assert.ok(spec.secretNames.includes('SESSION_SECRET') && spec.secretNames.includes('SETUP_TOKEN'));
  assert.equal(spec.surfaces.app.path, '/app');
  console.log(`Delivery artifact passed: ${artifact.modules.length} actual Worker modules, ${artifact.assets.length} actual assets, ${migrations.length} exact migrations, native Durable Object and both queues.`);
} finally { await rm(directory, { recursive: true, force: true }); }
