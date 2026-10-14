import assert from 'node:assert/strict';
import { confirmAuthLink } from '../auth-client.mjs';
import { snapshot, scan, containsPersonal } from './scan.mjs';
import { dialPolicy, guardedBucket } from '../../scripts/local/archive-policy.mjs';
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability';

/** Existing DATA-002 journey: genuine native accounts retain authority while
 * one email confirmation erases their independent invitee facts and capabilities. */
export async function eraseOperatorInviteeRecords(rt, context) {
  await rt.data('/__fixtures/setup', {});
  const ordinaryEmail = 'overlap-operator-82419@example.test';
  const ordinary = (await rt.data('/api/app/operators', { email: ordinaryEmail }, 201)).operator;
  const messages = (await rt.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY rowid DESC').all()).results.map(row => JSON.parse(row.message));
  const invitation = messages.find(message => message.to.includes(ordinaryEmail));
  const link = invitation.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/u)?.[0];
  assert.ok(link, 'native invitation supplied a sign-in link');
  const joined = await confirmAuthLink(link);
  assert.equal(joined.status, 303, 'ordinary operator completed actual native invitation');
  const ordinaryCookie = joined.headers.get('set-cookie').split(';')[0];
  const owner = (await rt.data('/api/app/operators')).operators.find(row => row.setupOperator);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
  const avatarResponse = await rt.api('/api/app/profile/avatar', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
  assert.equal(avatarResponse.status, 200); const avatar = await avatarResponse.json();
  const profile = await rt.data('/api/app/profile');
  const event = await rt.data('/api/public/events/dial-host/intro');
  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const cases = [
    { kind: 'ordinary-other-operator', email: ordinaryEmail, operator: ordinary, name: 'OVERLAP_INVITEE_82419', text: 'OVERLAP_PRIVATE_82419' },
    { kind: 'self-protected-setup-owner', email: owner.email, operator: owner, name: 'OWNER_INVITEE_82419', text: 'OWNER_PRIVATE_82419' },
  ];
  for (const subject of cases) {
    const available = await rt.data(`/api/public/book/dial-host/intro/availability?week=${week}`);
    const startAt = available.slots[0].startAt;
    const selected = await rt.data('/api/public/book/dial-host/intro/selection', { startAt, inviteeTimezone: 'UTC' }, 201);
    subject.booking = await rt.data('/api/public/book/dial-host/intro/confirm', { nonce: selected.nonce, startAt, inviteeTimezone: 'UTC', name: subject.name, email: subject.email, answers: { [event.eventType.questions[0].key]: subject.text } }, 201);
    subject.composition = { inviteeName: subject.name, inviteeEmail: subject.email, inviteeTimezone: 'UTC', note: subject.text, windows: [{ date: week, startMinute: 600, endMinute: 630 }] };
    subject.review = await rt.data('/api/public/events/dial-host/intro/request/review', subject.composition, 201);
    await rt.data(`/api/public/events/dial-host/intro/request?nonce=${subject.review.nonce}`, subject.composition, 201);
    subject.bookingId = (await rt.data('/api/app/bookings')).find(row => row.inviteeName === subject.name).id;
    subject.requestId = (await rt.data('/api/app/availability-requests')).find(row => row.inviteeName === subject.name).id;
    for (const [entity, id] of [['booking', subject.bookingId], ['availabilityRequest', subject.requestId]]) {
      const field = await rt.data('/api/app/custom-fields', { entity, label: 'Overlap private note', kind: 'long_text', options: [] }, 201);
      await rt.data(`/api/app/custom-fields/${entity}/${id}/${field.id}`, { value: subject.text }, 200, 'PUT');
    }
  }
  await rt.data('/__fixtures/deliver', {});
  await rt.data('/__fixtures/deliver', {});
  assert.deepEqual(Buffer.from(await (await rt.bucket.get(avatar.avatarKey)).arrayBuffer()), png, 'upgrade preserves shared avatar bytes');
  const identityTables = ['oa_operators', 'operators', 'oa_sessions', 'oa_tokens', 'oa_bootstrap', 'operator_setup_identity'];
  const identities = () => Promise.all(identityTables.map(async table => [table, (await rt.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results]));
  const identityBefore = JSON.stringify(await identities());
  const archive = await dialPolicy(rt.db, { SESSION_SECRET: 'dial-booking-wire-synthetic-local-session-secret' });
  const transfers = await createPortability({ db: rt.db, buckets: { FILES: guardedBucket(rt.bucket, archive.knownSecrets) }, policy: archive.policy });
  const stale = await transfers.exports.create();
  const outcomes = [];
  for (const subject of cases) {
    const before = await snapshot(rt.db);
    const preview = await rt.data('/api/app/privacy/preview', { email: subject.email });
    assert.deepEqual({ bookings: preview.bookings, requests: preview.requests, retained: preview.operatorIdentityRetained }, { bookings: 1, requests: 1, retained: true });
    assert.equal(JSON.stringify(await snapshot(rt.db)) === JSON.stringify(before), true, 'operator-overlap preview has zero writes');
    const refused = await rt.api(`/api/app/operators/${subject.operator.id}/remove`, { method: 'POST' });
    assert.equal(refused.status, 409, 'separate operator removal remains held');
    assert.equal((await refused.json()).error.code, subject.kind === 'ordinary-other-operator' ? 'operator_identity_overlap' : 'self_erasure');
    // A native writer that repeats the retained email inside the destructive
    // batch must succeed; this was previously forbidden by admission.
    await rt.db.prepare(`CREATE TRIGGER erasure_same_identity_probe AFTER DELETE ON bookings BEGIN UPDATE oa_operators SET email=email WHERE id='${subject.operator.id}'; UPDATE operators SET normalized_email=normalized_email WHERE id='${subject.operator.id}'; END`).run();
    const receipt = await rt.data('/api/app/privacy/erase', { email: subject.email, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
    await rt.db.prepare('DROP TRIGGER erasure_same_identity_probe').run();
    assert.equal(receipt.localComplete, true);
    assert.equal(receipt.bookings, 1); assert.equal(receipt.requests, 1);
    assert.equal(receipt.operatorIdentityRetained, true);
    assert.equal(containsPersonal(receipt, [subject.email, subject.name, subject.text, subject.operator.id, subject.bookingId, subject.requestId]), false, 'receipt has only anonymous aggregate facts');
    assert.equal((await rt.data('/api/app/bookings')).some(row => row.id === subject.bookingId), false);
    assert.equal((await rt.data('/api/app/availability-requests')).some(row => row.id === subject.requestId), false);
    const audit = (await rt.db.prepare('SELECT * FROM anonymized_audit').all()).results;
    assert.equal(containsPersonal(audit, [subject.email, subject.name, subject.text, subject.operator.id, subject.bookingId, subject.requestId]), false, 'anonymized audit has no matching identity bridge');
    const deadManage = await rt.api(new URL(subject.booking.manageUrl).pathname.replace('/manage/', '/api/public/manage/'));
    assert.ok([404, 410].includes(deadManage.status)); await deadManage.arrayBuffer();
    const replay = await rt.api(`/api/public/events/dial-host/intro/request?nonce=${subject.review.nonce}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subject.composition) });
    assert.ok([404, 410].includes(replay.status)); await replay.arrayBuffer();
    await rt.data('/__fixtures/deliver', {}); await rt.data('/__fixtures/deliver', {});
    const completed = await rt.data(`/api/app/privacy/receipts/${receipt.id}`);
    assert.equal(completed.operatorIdentityRetained, true); assert.equal(completed.calendarCleanup, 'completed');
    const storage = await scan(rt.db, rt.bucket, [subject.name, subject.text]);
    assert.equal(JSON.stringify(await identities()) === identityBefore, true, 'native accounts, links, sessions and protected setup remain byte-for-byte unchanged');
    const retainedSession = await rt.api('/api/app/profile', { headers: { cookie: ordinaryCookie } });
    assert.equal(retainedSession.status, 200); await retainedSession.arrayBuffer();
    assert.deepEqual(await rt.data('/api/app/profile'), profile, 'setup owner session and shared host remain usable');
    assert.deepEqual(Buffer.from(await (await rt.bucket.get(avatar.avatarKey)).arrayBuffer()), png, 'invitee erasure preserves shared avatar bytes');
    const current = await transfers.exports.create();
    try {
      while ((await transfers.exports.advance(current, { maxParts: 32 })).phase === 'building') { /* actual durable native export */ }
      for await (const record of readArchive(await transfers.exports.download(current))) assert.equal(containsPersonal(record, [subject.name, subject.text]), false, 'export contains no erased invitee canary');
    } finally { await transfers.exports.abort(current); }
    outcomes.push({ kind: subject.kind, bookings: receipt.bookings, requests: receipt.requests, remainingBookings: 0, remainingRequests: 0, operatorIdentityRetained: completed.operatorIdentityRetained, storage });
  }
  await assert.rejects(() => transfers.exports.download(stale), /job_not_found/, 'old snapshot fenced despite retained native identity');
  const protectedFromOther = await rt.api(`/api/app/operators/${owner.id}/remove`, { method: 'POST', headers: { cookie: ordinaryCookie } });
  assert.equal(protectedFromOther.status, 409); assert.equal((await protectedFromOther.json()).error.code, 'setup_operator_erasure_hold');
  const selfRemove = await rt.api(`/api/app/operators/${ordinary.id}/remove`, { method: 'POST', headers: { cookie: ordinaryCookie } });
  assert.equal(selfRemove.status, 409); assert.equal((await selfRemove.json()).error.code, 'self_erasure');
  const removed = await rt.api(`/api/app/operators/${ordinary.id}/remove`, { method: 'POST' });
  assert.equal(removed.status, 204); await removed.arrayBuffer();
  const endedSession = await rt.api('/api/app/profile', { headers: { cookie: ordinaryCookie } });
  assert.equal(endedSession.status, 401); await endedSession.arrayBuffer();
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM oa_operators WHERE id=?').bind(ordinary.id).first()).n, 0, 'separate ordinary removal still erases its native account');
  await assert.rejects(() => rt.db.prepare('DELETE FROM oa_operators WHERE id=?').bind(owner.id).run(), /last_owner/, 'native last-owner invariant remains enforced');
  context.diagnostic(JSON.stringify({ overlapCases: outcomes, accountsAndSessionsPreserved: true, separateOperatorRemovalVerified: true }));
}
