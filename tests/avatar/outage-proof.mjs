import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { dialPolicy, guardedBucket } from '../../scripts/local/archive-policy.mjs';
import { createPortability, readArchive } from '../../scripts/base-cli/modules/portability/index.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
const path = '/api/app/profile/avatar';
async function portability(f) {
  const { policy, knownSecrets } = await dialPolicy(f.db, f.runtime);
  return createPortability({ db: f.db, buckets: { FILES: guardedBucket(f.bucket, knownSecrets) }, policy });
}

export async function avatarOutageProof() {
  let f = await fixture();
  let target;
  const cases = [];
  const upload = () => f.send(path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } });
  const profile = async () => (await f.send('/api/app/profile')).json();
  const objects = async () => (await f.bucket.list()).objects.map(row => row.key).sort();
  const intents = async () => (await f.db.prepare('SELECT id, object_key FROM avatar_object_deletions').all()).results;
  const control = async body => assert.equal((await f.send('/__fixture/put', { body })).status, 200);
  const paused = async () => (await f.send('/__fixture/put-paused')).json();
  const release = async () => assert.equal((await f.send('/__fixture/release-put', { body: {} })).status, 200);
  const updateRefusal = "CREATE TRIGGER fixture_pointer_refusal BEFORE UPDATE OF avatar_key ON host_profiles BEGIN SELECT RAISE(ABORT, 'synthetic-avatar-pointer-outage'); END";
  async function exactCurrent(expected) {
    assert.equal((await profile()).avatarKey, expected);
    assert.deepEqual(await objects(), expected ? [expected] : []);
    if (expected) {
      const response = await f.send(`/media/${expected}`, { anonymous: true });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
  }
  try {
    assert.equal((await upload()).status, 200);
    let current = (await profile()).avatarKey;
    await f.db.prepare(updateRefusal).run();
    await f.db.prepare("CREATE TRIGGER fixture_intent_refusal BEFORE INSERT ON avatar_object_deletions BEGIN SELECT RAISE(ABORT, 'synthetic-avatar-intent-outage'); END").run();
    assert.equal((await upload()).status, 503);
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    await f.db.prepare('DROP TRIGGER fixture_pointer_refusal').run();
    await f.db.prepare('DROP TRIGGER fixture_intent_refusal').run();
    assert.equal((await upload()).status, 200);
    current = (await profile()).avatarKey;
    await exactCurrent(current);
    cases.push({ case: 'continuing D1 write outage before PUT', response: 503, originalPreserved: true, objectsDuringOutage: 1, objectsAfterRetry: 1 });
    for (const fail of ['before', 'after']) {
      await control({ fail });
      assert.equal((await upload()).status, 503);
      await exactCurrent(current);
      assert.equal((await intents()).length, 0);
      cases.push({ case: `R2 PUT failure ${fail} storage`, response: 503, objects: 1, cleanupIntents: 0 });
    }
    await control({});
    await f.db.prepare(updateRefusal).run();
    assert.equal((await upload()).status, 503);
    await f.db.prepare('DROP TRIGGER fixture_pointer_refusal').run();
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    cases.push({ case: 'pointer update failure', response: 503, originalPreserved: true, objects: 1 });

    // Aborting retirement of the original must roll back publication and leave
    // the replacement's pre-existing cleanup authority intact.
    await f.db.prepare(`CREATE TRIGGER fixture_retirement_refusal BEFORE INSERT ON avatar_object_deletions WHEN NEW.object_key = '${current}' BEGIN SELECT RAISE(ABORT, 'synthetic-avatar-retirement-outage'); END`).run();
    assert.equal((await upload()).status, 503);
    await f.db.prepare('DROP TRIGGER fixture_retirement_refusal').run();
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    cases.push({ case: 'old-object retirement failure rolls publication back', response: 503, originalPreserved: true, objects: 1 });

    // The outage starts only after native R2 has committed the replacement.
    await control({ pause: 'after' });
    let held = upload();
    let barrier = await paused();
    assert.deepEqual((await intents()).map(row => row.object_key), [barrier.key]);
    await f.db.prepare(updateRefusal).run();
    await f.db.prepare("CREATE TRIGGER fixture_cleanup_refusal BEFORE UPDATE ON avatar_object_deletions BEGIN SELECT RAISE(ABORT, 'synthetic-avatar-cleanup-outage'); END").run();
    await release();
    assert.equal((await held).status, 503);
    assert.equal((await profile()).avatarKey, current);
    assert.ok(await f.bucket.head(current));
    assert.deepEqual(await objects(), [current, barrier.key].sort());
    assert.deepEqual((await intents()).map(row => row.object_key), [barrier.key]);
    await f.db.prepare('DROP TRIGGER fixture_pointer_refusal').run();
    await f.db.prepare('DROP TRIGGER fixture_cleanup_refusal').run();
    assert.equal((await upload()).status, 200);
    current = (await profile()).avatarKey;
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    cases.push({ case: 'D1 outage begins after PUT', response: 503, originalPreserved: true, failedObjectDurablyTracked: true, objectsAfterRetry: 1 });

    // Cleanup observes committed bytes while the uploader has not published.
    // A failing remover leaves the old pointer unchanged; only the durable token
    // fence prevents the paused uploader from publishing its deleted R2 object.
    await control({ pause: 'after' });
    held = upload();
    barrier = await paused();
    await f.db.prepare(updateRefusal).run();
    assert.equal((await f.send(path, { method: 'DELETE' })).status, 503);
    await f.db.prepare('DROP TRIGGER fixture_pointer_refusal').run();
    assert.equal(await f.bucket.head(barrier.key), null);
    assert.equal((await profile()).avatarKey, current);
    await release();
    assert.equal((await held).status, 409);
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    cases.push({ case: 'cleanup wins before publication with unchanged old pointer', uploaderResponse: 409, currentReadable: true, objects: 1 });

    for (const method of ['PUT', 'DELETE']) {
      await control({ pause: 'before' });
      held = upload();
      barrier = await paused();
      assert.equal(await f.bucket.head(barrier.key), null);
      assert.ok((await intents()).some(row => row.object_key === barrier.key));
      const concurrent = await f.send(path, { method, ...(method === 'PUT' ? { bytes: png, headers: { 'content-type': 'image/png' } } : {}) });
      assert.equal(concurrent.status, 200);
      const winner = await concurrent.json();
      await release();
      assert.equal((await held).status, 409);
      await exactCurrent(winner.avatarKey);
      assert.equal((await intents()).length, 0);
      assert.equal((await upload()).status, 200);
      current = (await profile()).avatarKey;
      cases.push({ case: `PUT overlaps ${method} before storage`, uploaderResponse: 409, winnerResponse: 200, objectsAfterRetry: (await objects()).length });
    }

    await control({ pause: 'after' });
    // Capture the rejected dispatch before disposing the actual native runtime.
    held = upload().then(response => ({ response: response.status }), error => ({ interrupted: error.name }));
    barrier = await paused();
    assert.ok(await f.bucket.head(barrier.key));
    assert.ok((await intents()).some(row => row.object_key === barrier.key));
    await f.restart();
    await held;
    assert.equal((await profile()).avatarKey, current);
    assert.ok((await intents()).some(row => row.object_key === barrier.key));
    assert.equal((await upload()).status, 200);
    current = (await profile()).avatarKey;
    await exactCurrent(current);
    assert.equal((await intents()).length, 0);
    cases.push({ case: 'Worker terminated after PUT before publication', originalPointerSurvived: true, objectsAfterRestartRetry: 1 });

    await control({ pause: 'before' });
    held = upload().then(response => ({ response: response.status }), error => ({ interrupted: error.name }));
    barrier = await paused();
    assert.equal(await f.bucket.head(barrier.key), null);
    await f.restart();
    await held;
    assert.equal((await upload()).status, 200);
    current = (await profile()).avatarKey;
    await exactCurrent(current);
    assert.deepEqual((await intents()).map(row => row.object_key), [barrier.key]);

    // A no-object intent is a random-key tombstone, without personal bytes. It
    // remains durable, never grants publication to another writer, and does not
    // prevent a whole-install export/restore or healthy avatar mutations.
    const service = await portability(f);
    const exportId = await service.exports.create();
    while ((await service.exports.advance(exportId, { maxParts: 16 })).phase === 'building') { /* durable snapshot */ }
    const records = [];
    for await (const record of readArchive(await service.exports.download(exportId))) records.push(record);
    await service.exports.abort(exportId);
    await f.close(); f = undefined;
    target = await fixture({ initialize: false });
    const restore = await portability(target);
    const importId = await restore.imports.create(records.find(row => row.kind === 'manifest'));
    for (const part of records.filter(row => row.kind === 'part')) await restore.imports.uploadPart(importId, part.index, part);
    const closing = records.find(row => row.kind === 'closing');
    await restore.imports.finalize(importId, { contentHash: closing.contentHash, archiveHash: closing.archiveHash });
    assert.equal(await target.bucket.head(barrier.key), null);
    assert.equal((await target.db.prepare('SELECT object_key FROM avatar_object_deletions').first()).object_key, barrier.key);
    const restored = await target.send(`/media/${current}`, { anonymous: true });
    assert.equal(restored.status, 200);
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), png);
    assert.deepEqual((await target.bucket.list()).objects.map(row => row.key), [current]);
    cases.push({ case: 'Worker terminated before PUT', emptyIntentRetained: true, personalObjects: 1, exportRestore: 'passed' });
    return cases;
  } finally { await f?.close(); await target?.close(); }
}
