import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { eraseOperatorInviteeRecords } from './erasure/operator-overlap.mjs';
import { personalSource } from './erasure/personal-source.mjs';
import { snapshot, scan } from './erasure/scan.mjs';
import { hashToken } from '../modules/operator-auth/crypto.mjs';
import { dialPolicy, guardedBucket } from '../scripts/local/archive-policy.mjs';
import { createPortability } from '@runeditrun/rer/modules/portability';

contract(['DATA-002', 'CLIENT-001'], 'native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person', async (context) => {
  const rt = await bookingRuntime({ developmentMail: true });
  const email = 'erase-person-78321@example.test', name = 'PERSON_NAME_78321', text = 'PERSON_TEXT_78321';
  const unicodeAlias = 'eraſe-person-78321@example.test';
  const markers = [email, unicodeAlias, name, text];
  try {
    const imported = await personalSource(rt, { email, name, text });
    await rt.data('/__fixtures/setup', {});
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
    const avatarResponse = await rt.api('/api/app/profile/avatar', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
    assert.equal(avatarResponse.status, 200); const avatar = await avatarResponse.json();
    const event = await rt.data('/api/public/events/dial-host/intro');
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    async function book(personEmail, personName, answer) {
      const available = await rt.data(`/api/public/book/dial-host/intro/availability?week=${week}`);
      const startAt = available.slots[0].startAt;
      const selection = await rt.data('/api/public/book/dial-host/intro/selection', { startAt, inviteeTimezone: 'UTC' }, 201);
      return rt.data('/api/public/book/dial-host/intro/confirm', { nonce: selection.nonce, startAt, inviteeTimezone: 'UTC', name: personName, email: personEmail, answers: { [event.eventType.questions[0].key]: answer } }, 201);
    }
    const first = await book(unicodeAlias, name, text);
    const earlyPreview = await rt.data('/api/app/privacy/preview', { email });
    const clientBefore = await rt.data('/api/app/clients/history?' + new URLSearchParams({ email }));
    assert.equal(clientBefore.totalCount, 2, 'CLIENT-001 normalized email joins the imported booking and Unicode-alias booking');
    await book(email.toUpperCase(), name, text);
    const control = await book('control-person-78321@example.test', 'Control person', 'Control private answer');
    const composition = { inviteeName: name, inviteeEmail: email, inviteeTimezone: 'UTC', note: text, windows: [{ date: week, startMinute: 600, endMinute: 630 }] };
    const review = await rt.data('/api/public/events/dial-host/intro/request/review', composition, 201);
    await rt.data(`/api/public/events/dial-host/intro/request?nonce=${review.nonce}`, composition, 201);
    // A second unsubmitted review must lose its personal composition fingerprint too.
    const unsubmitted = await rt.data('/api/public/events/dial-host/intro/request/review', { ...composition, note: text + ' unsubmitted' }, 201);
    const rows = await rt.data('/api/app/bookings');
    const target = rows.find(row => row.inviteeEmail.toLowerCase() === email && row.imported);
    const native = rows.find(row => row.inviteeEmail.toLowerCase() === email && !row.imported);
    await rt.data(`/api/app/bookings/${target.id}/attendance`, { status: 'attended', note: text });
    const requests = await rt.data('/api/app/availability-requests');
    const request = requests.find(row => row.inviteeEmail === email);
    for (const [entity, id] of [['booking', target.id], ['availabilityRequest', request.id]]) {
      const field = await rt.data('/api/app/custom-fields', { entity, label: 'Private annotation', kind: 'long_text', options: [] }, 201);
      await rt.data(`/api/app/custom-fields/${entity}/${id}/${field.id}`, { value: text }, 200, 'PUT');
    }
    // Production cancellation stores an operator note and composes local mail.
    await rt.data(`/api/app/bookings/${native.id}/cancel`, { reason: text });
    await rt.data('/__fixtures/deliver', {});
    await rt.data('/__fixtures/deliver', {});
    await rt.data('/api/app/blocked-addresses', { kind: 'email', value: email }, 201);
    await rt.data('/auth/magic-link', { email, returnTo: '/app' }, 202);
    const knownHashes = (await rt.db.prepare('SELECT composition_hash FROM availability_request_review_nonces WHERE invitee_email=?').bind(email).all()).results.map(row => row.composition_hash);
    knownHashes.push(await hashToken('synthetic-dial-booking-wire-synthetic-local-session-secret', 'rate', `magic:email:${email}`));
    assert.ok(JSON.stringify(await snapshot(rt.db)).includes(text));
    await rt.data('/api/app/bookings?' + new URLSearchParams({ query: name }));
    assert.ok((await rt.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox WHERE instr(message,?)>0').bind(email).first()).n > 0, 'native development mailbox contains an actual sent personal message');
    const controlId = rows.find(row => row.inviteeEmail === 'control-person-78321@example.test').id;
    const clientHistory = () => rt.data('/api/app/clients/history?' + new URLSearchParams({ email: email.toUpperCase() }));
    const clientRows = await clientHistory();
    assert.equal(clientRows.totalCount, 3, 'three bookings by equivalent email spellings form one client history');
    assert.deepEqual(clientRows.bookings.map(row => row.id).sort(), rows.filter(row => row.inviteeName === name).map(row => row.id).sort());
    assert.ok(clientRows.bookings.every(row => row.answers.some(answer => answer.value === text)));
    assert.ok(clientRows.bookings.some(row => row.attendance?.note === text));
    assert.ok(clientRows.bookings.some(row => JSON.stringify(row.customFields).includes(text)));
    assert.equal(JSON.stringify(clientRows).includes('/manage/'), false, 'client projection contains no manage authority');
    const clients = await rt.data('/api/app/clients');
    assert.ok(clients.clients.some(row => row.email === email && row.bookingCount === 3));
    const controlClientPath = '/api/app/clients/history?' + new URLSearchParams({ email: 'control-person-78321@example.test' });
    const controlClientBefore = await rt.data(controlClientPath);
    assert.equal(controlClientBefore.totalCount, 1);
    for (const other of ['synthetic-dial-999@example.test', email.replace('@', '+other@')]) {
      assert.deepEqual((await rt.data('/api/app/clients/history?' + new URLSearchParams({ email: other }))).bookings, [], 'distinct and unknown email addresses never join another client');
    }
    const deniedClient = await rt.api('/api/app/clients/history?' + new URLSearchParams({ email }), { headers: { cookie: '' } });
    assert.equal(deniedClient.status, 401); await deniedClient.arrayBuffer();
    await rt.data('/api/app/clients?limit=0', undefined, 400);
    const pageOne = await rt.data('/api/app/clients?limit=1');
    const pageTwo = await rt.data('/api/app/clients?limit=1&offset=1');
    assert.notEqual(pageOne.clients[0].email, pageTwo.clients[0].email);
    assert.equal(pageOne.totalCount, clients.totalCount);
    const controlBefore = await rt.data(`/api/app/bookings/${controlId}`);
    const profileBefore = await rt.data('/api/app/profile');
    const archive = await dialPolicy(rt.db, { SESSION_SECRET: 'synthetic-dial-booking-wire-synthetic-local-session-secret' });
    const transfers = await createPortability({ db: rt.db, buckets: { FILES: guardedBucket(rt.bucket, archive.knownSecrets) }, policy: archive.policy });
    const frozenExport = await transfers.exports.create();
    const before = await snapshot(rt.db);
    const preview = await rt.data('/api/app/privacy/preview', { email: email.toUpperCase() });
    assert.deepEqual({ bookings: preview.bookings, requests: preview.requests, operatorIdentityRetained: preview.operatorIdentityRetained }, { bookings: 3, requests: 1, operatorIdentityRetained: false });
    assert.equal(JSON.stringify(await snapshot(rt.db)) === JSON.stringify(before), true, 'preview causes zero persisted writes');
    const body = { email, confirmation: preview.confirmation, expiresAt: preview.expiresAt };
    await rt.data('/api/app/privacy/erase', { email, confirmation: earlyPreview.confirmation, expiresAt: earlyPreview.expiresAt }, 409);
    await rt.data('/api/app/privacy/erase', { ...body, confirmation: '0'.repeat(64) }, 409);
    await rt.data('/api/app/privacy/erase', { ...body, expiresAt: 0 }, 409);
    for (const headers of [{ cookie: '' }, { origin: 'https://cross-site.example.test' }]) {
      const result = await rt.api('/api/app/privacy/erase', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      assert.ok([401, 403].includes(result.status));
      await result.arrayBuffer();
    }
    assert.equal(JSON.stringify(await snapshot(rt.db)) === JSON.stringify(before), true, 'refused requests do not alter personal data');
    await rt.db.prepare("CREATE TRIGGER erasure_failure_probe AFTER DELETE ON bookings BEGIN SELECT RAISE(ABORT,'synthetic atomic failure'); END").run();
    const failed = await rt.api('/api/app/privacy/erase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(failed.status >= 500); await failed.arrayBuffer();
    const afterFailure = await snapshot(rt.db);
    assert.ok(afterFailure.processor_erasure_requests.every(row=>!JSON.stringify(row).includes(email)&&!JSON.stringify(row).includes(name)),"retained processor commands carry no personal value even after failed local deletion");
    for (const table of Object.keys(before).filter(table => !['person_erasure_locks','person_erasure_receipts','processor_erasure_requests'].includes(table))) assert.equal(JSON.stringify(afterFailure[table]) === JSON.stringify(before[table]), true, `${table}: failed native batch must roll back`);
    const pending = await rt.data('/api/app/privacy/preview', { email });
    assert.equal(pending.pending, true); assert.equal(pending.bookings, 3);
    // A pending real person operation closes identity and invitee admission;
    // none of these native writers may slip a new owner or record past it.
    await assert.rejects(() => rt.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('racing-owner',?,'Racing owner','owner','active',?)").bind(unicodeAlias, Date.now()).run(), /person_erasure_in_progress/);
    await assert.rejects(() => rt.db.prepare("INSERT INTO operators(id,email,normalized_email,created_at,updated_at) VALUES('racing-product',?,?,?,?)").bind(email,email,new Date().toISOString(),new Date().toISOString()).run(), /person_erasure_in_progress/);
    await assert.rejects(() => rt.db.prepare("UPDATE oa_operators SET email=? WHERE email='operator@dial.test'").bind(email).run(), /person_erasure_in_progress/);
    await assert.rejects(() => rt.db.prepare("UPDATE operators SET normalized_email=? WHERE normalized_email='operator@dial.test'").bind(email).run(), /person_erasure_in_progress/);
    await assert.rejects(() => rt.db.prepare('UPDATE bookings SET invitee_email=? WHERE id=?').bind(email,controlId).run(), /person_erasure_in_progress/);
    const existingMail = before.delivery_outbox.find(row => row.kind === 'mail_send' && row.booking_id === native.id);
    assert.ok(existingMail, 'real booking mail provides the concurrent admission input');
    const racingMail = { ...existingMail, id: 'racing-mail', idempotency_key: 'racing-mail' };
    await assert.rejects(() => rt.db.prepare(`INSERT INTO delivery_outbox(${Object.keys(racingMail).join(',')}) VALUES(${Object.keys(racingMail).map(() => '?').join(',')})`).bind(...Object.values(racingMail)).run(), /person_erasure_in_progress/);
    const refusedReview = await rt.api('/api/public/events/dial-host/intro/request/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...composition, note: 'Admission race' }) });
    assert.ok(refusedReview.status >= 400); await refusedReview.arrayBuffer();
    await assert.rejects(() => transfers.exports.create(), /person_erasure_in_progress/);
    const unchangedExport = await transfers.exports.status(frozenExport);
    assert.ok(unchangedExport, 'failed native erase rolls back transfer invalidation');
    await rt.db.prepare('DROP TRIGGER erasure_failure_probe').run();
    const targets = rows.filter(row => row.inviteeName === name).map(row => row.id).sort();
    await rt.db.prepare(`CREATE TRIGGER erasure_partial_probe AFTER DELETE ON bookings WHEN OLD.id='${targets[1]}' BEGIN SELECT RAISE(ABORT,'synthetic second entity failure'); END`).run();
    const partial = await rt.api('/api/app/privacy/erase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(partial.status, 503); await partial.arrayBuffer();
    const resume = await rt.data('/api/app/privacy/preview', { email });
    assert.equal(resume.pending, true); assert.equal(resume.bookings, 2);
    assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM person_erasure_receipts WHERE completed_at IS NOT NULL').first()).n, 0);
    await rt.db.prepare('DROP TRIGGER erasure_partial_probe').run();
    const started = Date.now();
    const receipt = await rt.data('/api/app/privacy/erase', { email, confirmation: resume.confirmation, expiresAt: resume.expiresAt });
    const localMilliseconds = Date.now() - started;
    assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM person_erasure_receipts').first()).n, 1, 'partial erasure resumes its original anonymous receipt');
    assert.equal(receipt.localComplete, true);
    assert.equal(receipt.calendarCleanup, 'pending');
    assert.ok(receipt.externalRequests.some(item=>item.kind==='calendar_event_cancel'),'each known calendar cancellation is listed');
    assert.equal(receipt.bookings, 3); assert.equal(receipt.requests, 1);
    assert.equal(markers.some(marker => JSON.stringify(receipt).includes(marker)), false);
    assert.ok(receipt.completedAt);
    await assert.rejects(() => transfers.exports.download(frozenExport), /job_not_found/, "a pre-erasure snapshot cannot be downloaded after success");
    const localScan = await scan(rt.db, rt.bucket, markers, knownHashes);
    assert.deepEqual((await clientHistory()).bookings, [], 'person erasure removes the entire derived client history');
    assert.equal((await rt.data('/api/app/clients')).clients.some(row => row.email === email), false);
    assert.deepEqual(await rt.data(controlClientPath), controlClientBefore, 'control client history stays byte-identical');
    assert.deepEqual(await rt.data(`/api/app/bookings/${controlId}`), controlBefore);
    assert.deepEqual(await rt.data('/api/app/profile'), profileBefore);
    assert.deepEqual(Buffer.from(await (await rt.bucket.get(avatar.avatarKey)).arrayBuffer()), png);
    const rawPreview = await rt.api('/api/app/move-in/jobs/' + imported.job.id);
    assert.equal(rawPreview.status, 200); assert.equal((await rawPreview.text()).includes(text), false);
    const token = new URL(first.manageUrl).pathname.split('/').at(-1);
    const expired = await rt.api(`/api/public/manage/${token}`); assert.ok([404, 410].includes(expired.status)); await expired.arrayBuffer();
    const replay = await rt.api(`/api/public/events/dial-host/intro/request?nonce=${review.nonce}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(composition) });
    assert.ok([404, 410].includes(replay.status)); await replay.arrayBuffer();
    const staleReview = await rt.api(`/api/public/events/dial-host/intro/request/receipt?nonce=${unsubmitted.nonce}`); assert.ok([404, 410].includes(staleReview.status)); await staleReview.arrayBuffer();
    // The maintained Google adapter does real lookup/patch over the fake paid edge.
    await rt.data('/__fixtures/deliver', {}); await rt.data('/__fixtures/deliver', {});
    const completed = await rt.data(`/api/app/privacy/receipts/${receipt.id}`);
    const calendarMilliseconds = Date.now() - started;
    assert.ok(completed.externalRequests.filter(item=>item.kind==='calendar_event_cancel').every(item=>item.state==='completed'),'the person receipt lists each completed calendar request');
    assert.equal(completed.calendarCleanup, 'completed'); assert.ok(calendarMilliseconds < 300000);
    context.diagnostic(JSON.stringify({ receipt: { id: receipt.id, bookings: receipt.bookings, requests: receipt.requests, requestedAt: receipt.requestedAt, completedAt: receipt.completedAt, localComplete: receipt.localComplete, calendarCleanup: completed.calendarCleanup }, successfulResumeLocalMilliseconds: localMilliseconds, successfulResumeToCalendarMilliseconds: calendarMilliseconds, firstAttemptToCalendarMilliseconds: Date.now() - Date.parse(receipt.requestedAt), statuses: { preview: 200, staleConfirmation: 409, invalidConfirmation: 409, atomicFailure: failed.status, partialFailure: partial.status, resumedConfirmation: 200, receipt: 200, erasedManage: expired.status, replayedRequest: replay.status, erasedReview: staleReview.status } }));
    const events = (await rt.providerDb.prepare('SELECT payload FROM wire_events').all()).results.map(row => JSON.parse(row.payload));
    assert.ok(events.filter(row => row.status !== 'cancelled').every(row => row.extendedProperties.private['dial-booking-id'] === controlId));
    const controlManage = await rt.api(new URL(control.manageUrl).pathname.replace('/manage/', '/api/public/manage/'));
    assert.equal(controlManage.status, 200); await controlManage.arrayBuffer();
    const afterCalendarScan = await scan(rt.db, rt.bucket, markers, knownHashes);
    context.diagnostic(JSON.stringify({ allApplicationStorage: { afterLocalErasure: localScan, afterCalendarCleanup: afterCalendarScan, knownIdentityHashesChecked: knownHashes.length } }));
  } finally { await rt.close(); }
});

contract('DATA-002', 'one confirmation erases operator and self-owner invitee records while retaining native identity; unknown tables fail closed', async (context) => {
  const rt = await bookingRuntime({ developmentMail: true });
  try {
    await eraseOperatorInviteeRecords(rt, context);
    await rt.db.prepare('CREATE TABLE unclassified_personal_data(id TEXT PRIMARY KEY, value TEXT)').run();
    const before = await snapshot(rt.db);
    await rt.data('/api/app/privacy/preview', { email: 'someone@example.test' }, 409);
    assert.equal(JSON.stringify(await snapshot(rt.db)) === JSON.stringify(before), true, 'unknown table refusal leaves all rows unchanged');
    await rt.db.prepare('DROP TABLE unclassified_personal_data').run();
  } finally { await rt.close(); }
});
