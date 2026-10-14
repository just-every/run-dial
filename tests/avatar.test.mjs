import { readFile } from "node:fs/promises";
import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { fixture } from './avatar/fixture.mjs';
import { dialPolicy, guardedBucket } from '../scripts/local/archive-policy.mjs';
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
async function portability(f) {
  const { policy, knownSecrets } = await dialPolicy(f.db, f.runtime);
  return createPortability({ db: f.db, buckets: { FILES: guardedBucket(f.bucket, knownSecrets) }, policy });
}
contract('PROFILE-003', 'native Worker avatar admission, replacement, public inline serving, removal and original-byte restore', async () => {
  let f = await fixture();
  let target;
  try {
    const path = '/api/app/profile/avatar';
    const rows = [];
    async function status(label, url, options, expected) {
      const response = await f.send(url, options);
      rows.push({ case: label, status: response.status });
      assert.equal(response.status, expected, label);
      return response;
    }
    await status('anonymous upload', path, { method: 'PUT', bytes: png, anonymous: true, headers: { 'content-type': 'image/png' } }, 401);
    await status('oversize upload', path, { method: 'PUT', bytes: new Uint8Array(5242881), headers: { 'content-type': 'image/png' } }, 413);
    await status('GIF upload', path, { method: 'PUT', bytes: Buffer.from('GIF89a'), headers: { 'content-type': 'image/gif' } }, 415);
    await status('declared type mismatch', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/jpeg' } }, 415);
    for (const [type, bytes] of [['image/png', png.subarray(0, 8)], ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])], ['image/webp', Buffer.from('RIFF0000WEBP')], ['image/avif', Buffer.concat([Buffer.from([0,0,0,16]), Buffer.from('ftypavif0000')])], ['image/png', Buffer.alloc(0)]]) {
      await status('empty or truncated image signature', path, { method: 'PUT', bytes, headers: { 'content-type': type } }, 415);
    }
    for (const [type, bytes] of [
      ['image/jpeg', await readFile(new URL('./avatar/jpeg.jpg', import.meta.url))],
      ['image/webp', await readFile(new URL('./avatar/webp.webp', import.meta.url))],
      ['image/avif', await readFile(new URL('./avatar/avif.avif', import.meta.url))],
    ]) {
      const accepted = await (await status(`valid ${type} signature`, path, { method: 'PUT', bytes, headers: { 'content-type': type } }, 200)).json();
      const response = await status(`anonymous ${type} GET`, `/media/${accepted.avatarKey}`, { anonymous: true }, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const uploaded = await (await status('valid PNG upload', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }, 200)).json();
    const media = `/media/${uploaded.avatarKey}`;
    const publicAvatar = await status('anonymous avatar GET', media, { anonymous: true }, 200);
    assert.equal(publicAvatar.headers.get('content-type'), 'image/png');
    assert.equal(publicAvatar.headers.get('content-disposition'), 'inline');
    assert.equal(publicAvatar.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(publicAvatar.headers.get('set-cookie'), null);
    assert.deepEqual(Buffer.from(await publicAvatar.arrayBuffer()), png);
    await f.bucket.put('private-object', png, { httpMetadata: { contentType: 'image/png' } });
    await status('non-avatar R2 key', '/media/private-object', { anonymous: true }, 404);
    await f.bucket.delete('private-object');
    const inactiveKey = `avatars/${crypto.randomUUID()}`;
    await f.bucket.put(inactiveKey, png, { httpMetadata: { contentType: 'image/png' } });
    await status('inactive avatar R2 key', `/media/${inactiveKey}`, { anonymous: true }, 404);
    await f.bucket.delete(inactiveKey);
    for (const malformed of ['/media/', '/media/avatars/no-such-key', `${media}/extra`]) await status('other media path', malformed, { anonymous: true }, 404);
    assert.equal((await (await f.send('/api/public/profiles/avatar-host', { anonymous: true })).json()).profile.avatarKey, uploaded.avatarKey);
    let replaced = await (await status('replace PNG', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }, 200)).json();
    assert.notEqual(replaced.avatarKey, uploaded.avatarKey);
    assert.equal(await f.bucket.get(uploaded.avatarKey), null);
    await status('replaced key GET', media, { anonymous: true }, 404);
    await f.db.prepare("CREATE TRIGGER fixture_avatar_failure BEFORE UPDATE OF avatar_key ON host_profiles BEGIN SELECT RAISE(ABORT, 'synthetic-avatar-write-failure'); END").run();
    try {
      await status('failed replacement', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }, 503);
      assert.equal((await (await f.send('/api/app/profile')).json()).avatarKey, replaced.avatarKey);
      assert.ok(await f.bucket.get(replaced.avatarKey));
      assert.deepEqual((await f.bucket.list()).objects.map(object => object.key), [replaced.avatarKey]);
    } finally { await f.db.prepare('DROP TRIGGER fixture_avatar_failure').run(); }
    const concurrent = await Promise.all([
      f.send(path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }),
      f.send(path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }),
      f.send(path, { method: 'DELETE' }),
    ]);
    assert.ok(concurrent.every(response => [200, 409].includes(response.status)));
    const current = await (await f.send('/api/app/profile')).json();
    assert.deepEqual((await f.bucket.list()).objects.map(object => object.key), current.avatarKey ? [current.avatarKey] : []);
    replaced = await (await status('avatar after overlapping changes', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }, 200)).json();
    for (const method of ['PUT', 'DELETE']) {
      const oldKey = replaced.avatarKey;
      await f.send('/__fixture/fail-delete', { body: { enabled: true } });
      await status(`R2 outage during ${method}`, path, { method, ...(method === 'PUT' ? { bytes: png, headers: { 'content-type': 'image/png' } } : {}) }, 503);
      assert.ok(await f.bucket.get(oldKey));
      assert.equal((await f.db.prepare('SELECT object_key FROM avatar_object_deletions').first()).object_key, oldKey);
      await status('old key during R2 outage', `/media/${oldKey}`, { anonymous: true }, 404);
      await f.send('/__fixture/fail-delete', { body: { enabled: false } });
      replaced = await (await status('retry cleans durable R2 intent', path, { method: 'PUT', bytes: png, headers: { 'content-type': 'image/png' } }, 200)).json();
      assert.equal(await f.bucket.get(oldKey), null);
      assert.equal((await f.db.prepare('SELECT count(*) AS n FROM avatar_object_deletions').first()).n, 0);
      assert.deepEqual((await f.bucket.list()).objects.map(object => object.key), [replaced.avatarKey]);
    }
    // Exercise the same native archive composition used by the command.
    const service = await portability(f);
    const exportId = await service.exports.create();
    while ((await service.exports.advance(exportId, { maxParts: 16 })).phase === 'building') { /* durable snapshot */ }
    const records = [];
    for await (const record of readArchive(await service.exports.download(exportId))) records.push(record);
    await service.exports.abort(exportId);
    await status('remove avatar', path, { method: 'DELETE' }, 200);
    await status('removed key GET', `/media/${replaced.avatarKey}`, { anonymous: true }, 404);
    assert.equal(await f.bucket.get(replaced.avatarKey), null);
    await f.close(); f = undefined;
    target = await fixture({ initialize: false });
    const restore = await portability(target);
    const manifest = records.find(record => record.kind === 'manifest');
    const importId = await restore.imports.create(manifest);
    for (const part of records.filter(record => record.kind === 'part')) await restore.imports.uploadPart(importId, part.index, part);
    const closing = records.find(record => record.kind === 'closing');
    await restore.imports.finalize(importId, { contentHash: closing.contentHash, archiveHash: closing.archiveHash });
    const restored = await target.send(`/media/${replaced.avatarKey}`, { anonymous: true });
    assert.equal(restored.status, 200);
    assert.equal(restored.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), png);
    assert.equal((await target.bucket.get(replaced.avatarKey)).httpMetadata.contentType, 'image/png');
    console.log('Avatar HTTP status table:', JSON.stringify(rows));
  } finally { await f?.close(); await target?.close(); }
});
