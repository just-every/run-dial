import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { containsPersonal, snapshot } from './erasure/scan.mjs';

function csvRows(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\r' && text[index + 1] === '\n' && !quoted) {
      row.push(value); rows.push([...row]); row.length = 0; value = ''; index++;
    } else value += char;
  }
  assert.equal(quoted, false, 'CSV closes every quoted cell');
  assert.equal(value, '', 'CSV ends on a complete record');
  assert.equal(row.length, 0);
  return rows;
}

contract('ADMIN-002', 'owner reads and exports native erasure actions once without personal bridges or writes', async context => {
  const rt = await bookingRuntime({ developmentMail: true });
  const endpoint = '/api/app/audit/erasures';
  try {
    await rt.data('/__fixtures/setup', {});
    const actor = (await rt.data('/api/app/session')).operator.id;
    const event = await rt.data('/api/public/events/dial-host/intro');
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const email = ['synthetic-dial-2201', 'example.test'].join('@');
    const name = 'synthetic-dial-2202', privateAnswer = 'synthetic-dial-2203';
    async function book(inviteeEmail, inviteeName) {
      const available = await rt.data(`/api/public/book/dial-host/intro/availability?week=${week}`);
      const startAt = available.slots[0].startAt;
      const selection = await rt.data('/api/public/book/dial-host/intro/selection', { startAt, inviteeTimezone: 'UTC' }, 201);
      return rt.data('/api/public/book/dial-host/intro/confirm', {
        nonce: selection.nonce, startAt, inviteeTimezone: 'UTC', name: inviteeName, email: inviteeEmail,
        answers: { [event.eventType.questions[0].key]: privateAnswer },
      }, 201);
    }
    const booking = await book(email, name);
    const controlEmail = ['synthetic-dial-2204', 'example.test'].join('@');
    const control = await book(controlEmail, 'synthetic-dial-2205');
    const composition = { inviteeName: name, inviteeEmail: email, inviteeTimezone: 'UTC', note: privateAnswer, windows: [{ date: week, startMinute: 600, endMinute: 630 }] };
    const review = await rt.data('/api/public/events/dial-host/intro/request/review', composition, 201);
    await rt.data(`/api/public/events/dial-host/intro/request?nonce=${review.nonce}`, composition, 201);
    const bookingId = (await rt.data('/api/app/bookings')).find(row => row.inviteeEmail === email).id;
    const requestId = (await rt.data('/api/app/availability-requests')).find(row => row.inviteeEmail === email).id;
    const controlId = (await rt.data('/api/app/bookings')).find(row => row.inviteeEmail === controlEmail).id;
    await rt.data('/__fixtures/deliver', {});
    await rt.data('/__fixtures/deliver', {});
    const controlBefore = await rt.data(`/api/app/bookings/${controlId}`);
    const empty = await rt.api(endpoint);
    assert.equal(empty.status, 200); assert.equal(empty.headers.get('x-total-count'), '0');
    assert.deepEqual(await empty.json(), []);
    assert.equal(csvRows(await (await rt.api(endpoint + '.csv')).text()).length, 1);

    const deletion = await rt.api(`/api/app/bookings/${bookingId}`, { method: 'DELETE' });
    assert.equal(deletion.status, 202); await deletion.arrayBuffer();
    const requestDeletion = await rt.api(`/api/app/availability-requests/${requestId}`, { method: 'DELETE' });
    assert.equal(requestDeletion.status, 204); await requestDeletion.arrayBuffer();
    const expected = (await rt.db.prepare("SELECT id, happened_at FROM anonymized_audit WHERE action='erased' ORDER BY happened_at DESC,id DESC").all()).results;
    assert.equal(expected.length, 2, 'each real native erasure writes exactly one action');
    assert.ok((await rt.db.prepare('SELECT count(*) AS n FROM anonymized_audit').first()).n > 2, 'other surviving history exists and must remain outside this projection');
    const erased = await rt.data(endpoint);
    assert.deepEqual(erased.map(row => row.id), expected.map(row => row.id));
    assert.deepEqual(erased.map(row => row.happenedAt), expected.map(row => row.happened_at), 'original action times survive');
    assert.deepEqual(erased.map(row => row.subjectKind).sort(), ['availability_request', 'booking']);
    assert.ok(erased.every(row => row.actorType === 'operator' && row.actorId === actor && row.action === 'erased'));

    const repeatBooking = await rt.api(`/api/app/bookings/${bookingId}`, { method: 'DELETE' });
    assert.ok([202, 404].includes(repeatBooking.status)); await repeatBooking.arrayBuffer();
    const repeatRequest = await rt.api(`/api/app/availability-requests/${requestId}`, { method: 'DELETE' });
    assert.equal(repeatRequest.status, 404); await repeatRequest.arrayBuffer();
    const replay = await rt.api(`/api/public/events/dial-host/intro/request?nonce=${review.nonce}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(composition),
    });
    assert.ok([404, 410].includes(replay.status)); await replay.arrayBuffer();
    assert.deepEqual(await rt.data(endpoint), erased, 'retries and capture replay cannot add a duplicate action');
    const deadManage = await rt.api(new URL(booking.manageUrl).pathname.replace('/manage/', '/api/public/manage/'));
    assert.ok([404, 410].includes(deadManage.status)); await deadManage.arrayBuffer();

    // Payment and private diagnostic columns may survive under their existing
    // retention policy. Even on a matching action they cannot enter this view.
    const processorRef = 'synthetic-dial-2206';
    await rt.db.prepare("UPDATE anonymized_audit SET processor_ref=?, reason=?, amount_cents=123 WHERE action='erased'").bind(processorRef, privateAnswer).run();
    const beforeReads = await snapshot(rt.db);
    for (const path of [endpoint, endpoint + '.csv']) {
      for (const cookie of ['', 'oa_session=synthetic-dial-2207']) {
        const denied = await rt.api(path, { headers: { cookie } });
        assert.equal(denied.status, 401, 'anonymous and forged sessions cannot read either door'); await denied.arrayBuffer();
      }
    }
    for (const query of ['?limit=0', '?limit=501', '?offset=-1', '?offset=1.5', '?limit=wrong']) await rt.data(endpoint + query, undefined, 400);
    const pageOne = await rt.api(endpoint + '?limit=1');
    const pageTwo = await rt.api(endpoint + '?limit=1&offset=1');
    for (const response of [pageOne, pageTwo]) {
      assert.equal(response.status, 200); assert.equal(response.headers.get('x-total-count'), '2');
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
    }
    assert.deepEqual([...(await pageOne.json()), ...(await pageTwo.json())], erased);
    const beyond = await rt.api(endpoint + '?limit=1&offset=2');
    assert.equal(beyond.headers.get('x-total-count'), '2'); assert.deepEqual(await beyond.json(), []);
    const exported = await rt.api(endpoint + '.csv');
    assert.equal(exported.status, 200); assert.match(exported.headers.get('content-type'), /text\/csv/);
    assert.match(exported.headers.get('content-disposition'), /^attachment;/);
    assert.match(exported.headers.get('cache-control'), /private.*no-store/);
    const csv = await exported.text(), parsed = csvRows(csv);
    assert.deepEqual(parsed[0], ['id', 'actorType', 'actorId', 'happenedAt', 'action', 'subjectKind']);
    assert.deepEqual(parsed.slice(1), erased.map(row => [row.id, 'operator', actor, row.happenedAt, 'erased', row.subjectKind]));
    const markers = [email, name, privateAnswer, bookingId, requestId, booking.manageUrl, review.nonce, processorRef];
    assert.equal(containsPersonal([erased, csv], markers), false, 'neither output carries erased subjects, private answers, capabilities or processor references');
    const write = await rt.api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(write.status, 404); await write.arrayBuffer();
    assert.deepEqual(await snapshot(rt.db), beforeReads, 'successful and refused audit reads and unsupported writes leave every source row unchanged');
    assert.deepEqual(await rt.data(`/api/app/bookings/${controlId}`), controlBefore);
    const controlManage = await rt.api(new URL(control.manageUrl).pathname.replace('/manage/', '/api/public/manage/'));
    assert.equal(controlManage.status, 200); await controlManage.arrayBuffer();

    // A populated retained log exceeds one maximum JSON page. It is read data,
    // not a scale claim: the CSV must traverse every page without truncation.
    const time = '2025-01-01T00:00:00.000Z';
    for (let start = 0; start < 501; start += 100) await rt.db.batch(Array.from({ length: Math.min(100, 501 - start) }, (_, index) =>
      rt.db.prepare("INSERT INTO anonymized_audit(id,entity_kind,action,actor_type,actor_id,happened_at,erased_at) VALUES(?,'booking','erased','operator',NULL,?,?)")
        .bind(`synthetic-dial-${2300 + start + index}`, time, time)));
    const populatedBefore = await snapshot(rt.db);
    const first = await rt.api(endpoint + '?limit=500');
    const last = await rt.api(endpoint + '?limit=500&offset=500');
    assert.equal(first.headers.get('x-total-count'), '503'); assert.equal(last.headers.get('x-total-count'), '503');
    const all = [...await first.json(), ...await last.json()];
    assert.equal(all.length, 503); assert.equal(new Set(all.map(row => row.id)).size, 503);
    const fullCsv = csvRows(await (await rt.api(endpoint + '.csv')).text());
    assert.equal(fullCsv.length, 504);
    assert.deepEqual(fullCsv.slice(1), all.map(row => [row.id, row.actorType, row.actorId ?? '', row.happenedAt, row.action, row.subjectKind]), 'full CSV and paginated JSON agree, including tied times and anonymous actors');
    assert.deepEqual(await snapshot(rt.db), populatedBefore, 'full export preserves the retained log and every unrelated table');
    context.diagnostic('PROBE ADMIN-002 erasure actions: native booking and request DELETE -> two visible JSON and CSV actions; retry and replay -> no duplicates');
    context.diagnostic('PROBE ADMIN-002 projection: owner JSON pages and full CSV -> 503 matching rows, anonymous or forged reads 401, source rows unchanged, no private bridges');
  } finally { await rt.close(); }
});
