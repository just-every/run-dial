import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { deployedFixture } from './archive/deployed-fixture.mjs';
import { createArchive } from './archive/artifact.mjs';
import { secret, testPlatform } from './archive/fixture.mjs';
import { assertCoverage, exported, excluded, internal } from '../scripts/archive/policy.mjs';
import { applicationCatalog, catalogQuery, tableQuery } from '../scripts/archive/schema.mjs';
import { restoreArchive } from './archive/artifact.mjs';

contract('DATA-001', 'Base-installed schema exports all product records while preserving each populated installer ledger', async t => {
  const source = await deployedFixture(t, { populated: true, install: 'source' });
  const target = await deployedFixture(t);
  const sourceLedger = source.ledger(); const targetLedger = target.ledger();
  assert.notDeepEqual(sourceLedger, targetLedger, 'independent installations have distinct bookkeeping');
  const sourceCatalog = source.db.prepare(catalogQuery).all();
  const targetCatalog = target.db.prepare(catalogQuery).all();
  const platform = testPlatform(source.db); const destination = testPlatform(target.db);
  platform.objects.set('avatar/original.bin', { bytes: Buffer.from([0, 255, 19, 128]), contentType: 'image/png' });
  platform.objects.set('asset/no-type', { bytes: Buffer.from('original upload'), contentType: null });

  // Exercise the production exporter first: before classification this rejects
  // the real Base-created table with archive-unclassified-schema.
  const archive = await createArchive(platform);
  const names = source.db.prepare(tableQuery).all().map(row => row.name);
  assertCoverage(names);
  assert.match(internal._rer_deploy_migrations, /installer/i);
  assert.ok(!Object.hasOwn(excluded, '_rer_deploy_migrations'));
  assert.deepEqual(archive.tables.map(table => table.name), exported);
  for (const table of archive.tables) {
    if (table.name === "operator_erasure_subjects") assert.equal(table.rows.length, 0, "unfinished operator erasure cannot be archived");
    else assert.ok(table.rows.length > 0, `${table.name} is populated`);
  }
  assert.ok(!archive.tables.some(table => table.name === '_rer_deploy_migrations'));
  assert.deepEqual(archive.migrations, source.migrations, 'archive retains exact product migration hashes');
  assert.ok(!JSON.stringify(archive).includes(secret), 'planted credentials stay excluded');
  assert.deepEqual(applicationCatalog(sourceCatalog), applicationCatalog(targetCatalog));
  assert.ok(!applicationCatalog(sourceCatalog).some(row => row.tbl_name === '_rer_deploy_migrations'));

  await restoreArchive(destination, archive);
  assert.deepEqual(await createArchive(destination), archive);
  assert.deepEqual(destination.objects, platform.objects, 'original R2 bytes and content types round trip');
  assert.deepEqual(source.ledger(), sourceLedger);
  assert.deepEqual(target.ledger(), targetLedger, 'restore keeps destination installer claims and hashes');
  assert.deepEqual(applicationCatalog(source.db.prepare(catalogQuery).all()), applicationCatalog(sourceCatalog));
  assert.deepEqual(applicationCatalog(target.db.prepare(catalogQuery).all()), applicationCatalog(targetCatalog));
  for (const name of Object.keys(excluded)) assert.equal(target.db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n, 0);
  const writes = { ...destination.writes };
  await assert.rejects(restoreArchive(destination, archive), /target_not_empty/);
  assert.deepEqual(destination.writes, writes);
  assert.deepEqual(target.ledger(), targetLedger);
});

contract('BASE-DATA-001', 'installed migration bookkeeping never exempts unknown product schema', async t => {
  const source = await deployedFixture(t, { populated: true, install: 'source' });
  const target = await deployedFixture(t);
  const sourceLedger = source.ledger(); const targetLedger = target.ledger();
  const platform = testPlatform(source.db); const destination = testPlatform(target.db);
  const archive = await createArchive(platform);
  for (const name of ['future_owner_data', '_rer_deploy_future_data']) {
    source.db.exec(`CREATE TABLE "${name}"(id TEXT)`);
    await assert.rejects(createArchive(platform), /archive-unclassified-schema/);
    source.db.exec(`DROP TABLE "${name}"`);
    target.db.exec(`CREATE TABLE "${name}"(id TEXT)`);
    await assert.rejects(restoreArchive(destination, archive), /archive-unclassified-schema/);
    target.db.exec(`DROP TABLE "${name}"`);
  }
  target.db.exec('CREATE INDEX unexpected_owner_index ON host_profiles(handle)');
  await assert.rejects(restoreArchive(destination, archive), /archive-schema-mismatch/);
  assert.deepEqual(destination.writes, { database: 0, objects: 0 });
  assert.deepEqual(source.ledger(), sourceLedger);
  assert.deepEqual(target.ledger(), targetLedger);
});
