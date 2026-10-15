import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { freshCopy, runRer, removeCopy, start, environment, variables } from './runtime.mjs';
import { readArchive } from '@runeditrun/rer/modules/portability';
import { assertNoSecretValues } from '../../scripts/owner-session/export-proof.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { openGateFromLink } from '../dev-key.mjs';
import { anotherHostedOwner, localOwnerCookie } from './hosted-authority.mjs';
import { answer } from './hosted-records.mjs';
import { evidencePath } from '../../scripts/evidence-path.mjs';
import { publishedPackage } from './published-package.mjs';
import { expiredCheckpoint } from './hosted-checkpoint.mjs';

async function inspect(path) {
 const bytes = await readFile(path), records = [];
 for await (const record of readArchive(new Blob([bytes]).stream())) records.push(record);
 return { bytes, records, manifest: records[0], closing: records.at(-1) };
}
/** Ordinary native application upload/session, hosted HTTP transport and public
 * CLI import in an independent empty checkout. No fake application endpoints. */
export async function hostedExportJourney(page, { openUrl, ownerGrant, hostedMigrations, origin, privateBytes, values, records, stopSource, checkpointState }) {
 const publishedProof = await publishedPackage();
 const directory = await freshCopy(); let destination, context;
 const evidence = { source: 'real-local-hosted-standin', liveProviderCalls: false };
 try {
  await runRer(directory, ['install'], { timeout: 300_000 });
  await writeFile(join(directory, '.dev.vars'), privateBytes, { mode: 0o600 });
  const cookie = await localOwnerCookie(origin, values.SESSION_SECRET);
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, sameSite: 'Lax' }]);
  assert.equal((await fetch(origin + '/api/app/session', { headers: { Cookie: cookie } })).status, 200);
  const sessionPath = '.rer/local/hosted-owner.cookie', sessionFile = join(directory, sessionPath);
  await mkdir(join(directory, '.rer/local'), { recursive: true, mode: 0o700 });
  await writeFile(sessionFile, cookie, { mode: 0o600 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
  const upload = await page.request.put(origin + '/api/app/profile/avatar', { headers: { origin, 'content-type': 'image/png' }, data: png });
  assert.equal(upload.status(), 200); const profile = await upload.json();
  assert.deepEqual(Buffer.from(await (await page.request.get(origin + '/media/' + profile.avatarKey)).body()), png);
  const otherCookie = await anotherHostedOwner(origin, { openUrl, secret: values.SESSION_SECRET, ownerGrant });
  const api = '/api/portability/exports';
  assert.equal((await fetch(origin + api, { method: 'POST', headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(origin + api, { method: 'POST', headers: { Origin: 'https://other.invalid', Cookie: cookie } })).status, 403);
  assert.equal((await fetch(origin + '/api/portability/imports', { method: 'POST', headers: { Origin: origin, Cookie: cookie } })).status, 404);
  assert.equal((await fetch(origin + api + '/unknown-job', { headers: { Cookie: cookie } })).status, 404);
  // A held snapshot excludes ordinary requests. After expiry the published
  // client must still clean it up, even when snapshot preflight no longer passes.
  const created = await fetch(origin + api, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(created.status, 201); const job = await created.json();
  assert.equal((await fetch(origin + api + '/' + job.id, { headers: { Cookie: otherCookie } })).status, 404, 'another native owner cannot read this job');
  assert.equal((await fetch(origin + api + '/' + job.id + '/abort', { method: 'POST', headers: { Origin: origin, Cookie: otherCookie } })).status, 404, 'another native owner cannot abort this job');
  assert.equal((await fetch(origin + '/api/app/profile', { headers: { Cookie: cookie } })).status, 503);
  Object.assign(evidence, await expiredCheckpoint({ origin, cookie, otherCookie, id: job.id, directory, sessionFile, checkpointState }));
  assert.equal((await fetch(origin + '/api/app/profile', { headers: { Cookie: cookie } })).status, 200);
  await runRer(directory, ['export', '--target', 'remote', '--origin', origin, '--session-file', sessionPath, '--output', 'exports/hosted.rer']);
  let source = await inspect(join(directory, 'exports/hosted.rer'));
  assert.deepEqual(source.manifest.migrations, hostedMigrations, 'hosted applied migration history travels in the Base manifest');
  assert.equal((await stat(join(directory, 'exports/hosted.rer'))).mode & 0o077, 0);
  assert.deepEqual(source.manifest.tables.map(table => table.name).sort(), exported);
  for (const name of Object.keys(excluded)) assert.ok(source.manifest.excludedTables.includes(name));
  assertNoSecretValues(source.bytes, [values.SESSION_SECRET, values.SETUP_TOKEN, values.RER_DEV_KEY, cookie.split('=').slice(1).join('=')].filter(Boolean));
  const asset = source.manifest.objects.find(object => object.key === profile.avatarKey);
  assert.ok(asset); assert.equal(asset.httpMetadata.contentType, 'image/png');
  assert.equal(asset.sha256, createHash('sha256').update(png).digest('hex'));
  const bytes = Buffer.concat(source.records.filter(record => record.kind === 'part').flatMap(record => record.items.filter(item => item.kind === 'object' && item.key === profile.avatarKey).map(item => Buffer.from(item.data, 'base64'))));
  assert.deepEqual(bytes, png);
  if (publishedProof) {
   const packageEntry = publishedProof.entry;
   let captured = '';
   const published = spawnOwned(process.execPath, [packageEntry, 'export', '--target', 'remote', '--origin', origin, '--session-file', sessionPath, '--output', 'exports/published.rer', '--json'], { cwd: directory, env: environment() }, { label: 'published rer hosted export', onOutput: chunk => { captured += chunk; } });
   try { await published.waitForClose(180_000); }
   catch { throw Error('Published rer hosted export failed; captured private diagnostics omitted.'); }
   finally { await published.stop(); }
   assert.ok(captured.includes('contentHash'));
   const publishedSource = await inspect(join(directory, 'exports/published.rer'));
   assert.equal(publishedSource.closing.contentHash, source.closing.contentHash);
   source = publishedSource;
   Object.assign(evidence, publishedProof.receipt);
  }
  assert.equal((await fetch(origin + '/api/app/profile', { headers: { Cookie: cookie } })).status, 200, 'successful CLI cleanup reopens source');
  await stopSource();
  await assert.rejects(fetch(origin + '/health'), 'source is unavailable before restoration');
  evidence.sourceStoppedBeforeImport = true;
  const input = evidence.publishedCliExecuted ? 'exports/published.rer' : 'exports/hosted.rer';
  // Continuity is enforced before publishing to the empty target.
  await writeFile(join(directory, '.dev.vars'), privateBytes.toString().replace(values.SESSION_SECRET, 'different-private-owner-salt-for-refusal'), { mode: 0o600 });
  await runRer(directory, ['import', '--input', input, '--yes'], { expected: 4 });
  await writeFile(join(directory, '.dev.vars'), privateBytes, { mode: 0o600 });
  await runRer(directory, ['import', '--input', input, '--yes']);
  await runRer(directory, ['export', '--output', 'exports/restored.rer']);
  const restored = await inspect(join(directory, 'exports/restored.rer'));
  assert.equal(source.closing.contentHash, restored.closing.contentHash);
  assert.deepEqual(source.manifest.objects, restored.manifest.objects);
  await runRer(directory, ['import', '--input', input, '--yes'], { expected: 4 });
  await runRer(directory, ['setup', '--owner-email', values.OWNER_EMAIL, '--port', '15760', '--non-interactive'], { timeout: 300_000 });
  const targetOrigin = (await variables(directory)).APP_URL;
  destination = await start(directory, 'dev', targetOrigin);
  assert.equal((await fetch(targetOrigin + '/api/app/session', { headers: { Cookie: cookie } })).status, 401, 'source native session does not survive import');
  context = await page.context().browser().newContext();
  await openGateFromLink(context, destination.openUrl);
  const targetPage = await context.newPage();
  await targetPage.goto(destination.openUrl);
  await targetPage.waitForURL(targetOrigin + '/app');
  const targetBooking = await (await targetPage.request.get(targetOrigin + '/api/app/bookings/' + records.booking.id)).json();
  assert.equal(targetBooking.id, records.booking.id); assert.equal(targetBooking.inviteeEmail, records.booking.inviteeEmail);
  assert.equal(targetBooking.createdAt, records.booking.createdAt); assert.deepEqual(targetBooking.occurrence, records.booking.occurrence);
  assert.equal(targetBooking.answers[0].value, answer); assert.equal(targetBooking.calendarState, 'not_required');
  assert.equal((await targetPage.request.get(targetOrigin + '/api/public/manage/' + new URL(records.privateManageUrl, origin).pathname.split('/').at(-1))).status(), 404, 'old private manage link does not regain authority');
  const targetAsset = await targetPage.request.get(targetOrigin + '/media/' + profile.avatarKey);
  assert.equal(targetAsset.status(), 200); assert.equal(targetAsset.headers()['content-type'], 'image/png'); assert.deepEqual(await targetAsset.body(), png);
  const claim = await targetPage.request.post(targetOrigin + '/auth/bootstrap', { headers: { origin: targetOrigin }, data: { token: values.SETUP_TOKEN, displayName: 'Replacement owner' } });
  assert.equal(claim.status(), 409, 'import preserves consumed first-owner authority');
  await context.close(); context = undefined;
  await runRer(directory, ['dev', '--stop']); await destination.owned.stop(); destination = undefined;

  await assert.rejects(fetch(origin + '/health'), 'source remains unavailable after target proof');
  Object.assign(evidence, { passed: true, completeTableCoverage: true, hostedTrackedLedgerToLocalRestore: true, tables: source.manifest.tables.length, objects: source.manifest.objects.length, contentHash: source.closing.contentHash, sourceArchiveSha256: createHash('sha256').update(source.bytes).digest('hex'), independentEmptyDestination: true, saltMismatchRefused: true, sessionAndOriginRefused: true, otherNativeOwnerRefused: true, remoteImportNotExposed: true, bytesAndMetadataEquivalent: true, publicBookingAndAnswer: true, freshRuntimeRestoredBooking: true, oldSessionRefused: true, nonemptyRestoreRefused: true, originalOwnerClaimPreserved: true });
 } finally {
  await context?.close(); await destination?.owned.stop();
  await writeFile(evidencePath('hosted-export-roundtrip.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await removeCopy(directory);
 }
}
