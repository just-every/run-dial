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
  const target = await deployedFixture(t, { localLedger: true });
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
  assert.match(internal.d1_migrations, /installer/i);
  assert.ok(!Object.hasOwn(excluded, 'd1_migrations'));
  assert.deepEqual(archive.tables.map(table => table.name), exported);
  for (const table of archive.tables) {
    if (table.name === "operator_erasure_subjects") assert.equal(table.rows.length, 0, "unfinished operator erasure cannot be archived");
    else assert.ok(table.rows.length > 0, `${table.name} is populated`);
  }
  assert.ok(!archive.tables.some(table => table.name === 'd1_migrations'));
  assert.deepEqual(archive.migrations, source.migrations, 'archive retains exact product migration hashes');
  assert.ok(!JSON.stringify(archive).includes(secret), 'planted credentials stay excluded');
  assert.deepEqual(applicationCatalog(sourceCatalog), applicationCatalog(targetCatalog));
  assert.ok(!applicationCatalog(sourceCatalog).some(row => row.tbl_name === 'd1_migrations'));

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
  for (const [column, value] of [['sha256', 'changed-sql-bytes'], ['state', 'applying'], ['name', '9999_unrecognized.sql']]) {
    for (const [installation, binding, operation] of [[source, platform, () => createArchive(platform)], [target, destination, () => restoreArchive(destination, archive)]]) {
      const original = installation.ledger()[0], before = { ...binding.writes };
      installation.db.prepare(`UPDATE d1_migrations SET ${column}=? WHERE id=?`).run(value, original.id);
      await assert.rejects(operation(), /archive-migration-history-mismatch/);
      installation.db.prepare(`UPDATE d1_migrations SET ${column}=? WHERE id=?`).run(original[column], original.id);
      assert.deepEqual(binding.writes, before);
    }
  }
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

contract('DATA-001', 'Platform-installed schema round trips the native archive while each installation keeps its own validated Platform migration ledger', async t => {
  const source = await deployedFixture(t, { populated: true, install: 'source', platform: true });
  const target = await deployedFixture(t, { platform: true });
  const fresh = await deployedFixture(t, { platform: true });
  const sourceLedger = source.ledger(); const targetLedger = target.ledger(); const freshLedger = fresh.ledger();
  assert.notDeepEqual(sourceLedger, targetLedger, 'independent installations have distinct Platform timestamps');
  assert.deepEqual(sourceLedger.map(({ name, sha256 }) => ({ name, sha256 })), source.migrations.map(({ file, sha256 }) => ({ name: file.split('/').at(-1), sha256 })));
  assert.ok(!source.db.prepare(tableQuery).all().some(row => row.name === 'd1_migrations'), 'Platform installs carry only its own ledger');
  const platform = testPlatform(source.db); const destination = testPlatform(target.db); const empty = testPlatform(fresh.db);
  platform.objects.set('avatar/original.bin', { bytes: Buffer.from([0, 255, 19, 128]), contentType: 'image/png' });

  // v0.4.0 refused this exact database at export admission with archive-unclassified-schema.
  const archive = await createArchive(platform);
  assert.deepEqual(archive.tables.map(table => table.name), exported);
  assert.ok(!archive.tables.some(table => table.name === 'rer_migrations'));
  assert.deepEqual(archive.migrations, source.migrations, 'archive retains exact product migration hashes');
  await restoreArchive(destination, archive);
  assert.deepEqual(await createArchive(destination), archive);
  assert.deepEqual(destination.objects, platform.objects, 'original R2 bytes and content types round trip');
  assert.deepEqual(source.ledger(), sourceLedger);
  assert.deepEqual(target.ledger(), targetLedger, 'restore neither rewrites nor drops the destination Platform history');

  // Platform history is checked on both doors, not merely skipped.
  const [first] = sourceLedger, last = sourceLedger.at(-1);
  for (const change of [`UPDATE rer_migrations SET sha256='changed-sql-bytes' WHERE name='${first.name}'`, `UPDATE rer_migrations SET name='9999_unrecognized.sql' WHERE name='${first.name}'`,
    `UPDATE rer_migrations SET name='${last.name}#0-1' WHERE name='${last.name}'`, `DELETE FROM rer_migrations WHERE name='${last.name}'`]) {
    for (const [installation, binding, operation] of [[source, platform, () => createArchive(platform)], [fresh, empty, () => restoreArchive(empty, archive)]]) {
      const original = installation.ledger(), before = { ...binding.writes };
      installation.db.exec(`SAVEPOINT tamper; ${change}`);
      await assert.rejects(operation(), /archive-migration-history-mismatch/, change);
      installation.db.exec('ROLLBACK TO tamper; RELEASE tamper');
      assert.deepEqual(installation.ledger(), original);
      assert.deepEqual(binding.writes, before);
    }
  }
  // The ledger is classified by its exact name; other rer_ tables stay unknown.
  for (const installation of [source, fresh]) installation.db.exec('CREATE TABLE rer_migrations_future(id TEXT)');
  await assert.rejects(createArchive(platform), /archive-unclassified-schema/);
  await assert.rejects(restoreArchive(empty, archive), /archive-unclassified-schema/);
  assert.deepEqual(empty.writes, { database: 0, objects: 0 });
  assert.deepEqual(fresh.ledger(), freshLedger);
});
