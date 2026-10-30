import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';

contract('CLIENT-001', 'guest clients keep distinct booking history, annotations and private remembered-details authority through merges', async context => {
  const rt = await bookingRuntime({ developmentMail: true });
  const address = number => ['synthetic-dial-' + number, 'example.test'].join('@');
  const guest = address(201), alias = address(202), solo = address(209), primaries = [203, 204, 205].map(address);
  const historyPath = email => '/api/app/clients/history?' + new URLSearchParams({ email });
  const history = email => rt.data(historyPath(email));
  try {
    const setup = await rt.data('/__fixtures/setup', {});
    await rt.data(`/api/app/event-types/${setup.eventId}/guests`, { guestLimit: 3 }, 200, 'PUT');
    const event = await rt.data(`/api/app/event-types/${setup.eventId}`);
    const week = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const ids = [];
    for (const [index, email] of primaries.entries()) {
      const available = await rt.data('/api/public/book/dial-host/intro/availability?' + new URLSearchParams({ week }));
      const startAt = available.slots[0].startAt;
      const selection = await rt.data('/api/public/book/dial-host/intro/selection', { startAt, inviteeTimezone: 'UTC' }, 201);
      await rt.data('/api/public/book/dial-host/intro/confirm', {
        nonce: selection.nonce, startAt, inviteeTimezone: 'UTC', name: `Primary person ${index}`, email,
        guests: index === 0 ? [guest.toUpperCase(), alias, solo] : [guest, solo],
        answers: { [event.questions[0].key]: `Private primary answer ${index}` },
      }, 201);
      ids.push((await rt.data('/api/app/bookings?' + new URLSearchParams({ query: email })))[0].id);
    }
    const initial = await history(guest.toUpperCase());
    assert.equal(initial.totalCount, 3);
    assert.deepEqual(initial.bookings.map(row => row.id), ids);
    assert.deepEqual(initial.bookings.map(row => row.answers[0].value), [0, 1, 2].map(index => `Private primary answer ${index}`));
    assert.equal(JSON.stringify(initial).includes('/manage/'), false);
    await rt.data('/api/app/clients/notes', { email: solo, body: 'Guest-only preparation' }, 201);
    await rt.data('/api/app/clients/fields', { email: solo, label: 'Guest-only reference', value: 'synthetic-dial-210' }, 201);
    const soloHistory = await history(solo);
    assert.equal(soloHistory.totalCount, 3); assert.equal(soloHistory.notes.length, 1); assert.equal(soloHistory.fields.length, 1);
    const controlBefore = await history(primaries[1]);
    const bookingsBeforeErasure = (await rt.db.prepare('SELECT * FROM bookings ORDER BY id').all()).results;
    const preview = await rt.data('/api/app/privacy/preview', { email: solo });
    assert.equal(preview.bookings, 0, 'erasing a guest never claims primary booking custody');
    const receipt = await rt.data('/api/app/privacy/erase', { email: solo, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
    assert.equal(receipt.localComplete, true);
    const erased = await history(solo);
    assert.equal(erased.totalCount, 0); assert.deepEqual(erased.bookings, []); assert.deepEqual(erased.notes, []); assert.deepEqual(erased.fields, []);
    assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM booking_guests WHERE email=?').bind(solo).first()).n, 0);
    assert.deepEqual(await history(guest), initial);
    assert.deepEqual(await history(primaries[1]), controlBefore);
    assert.deepEqual((await rt.db.prepare('SELECT * FROM bookings ORDER BY id').all()).results, bookingsBeforeErasure);
    const list = await rt.data('/api/app/clients');
    assert.equal(list.totalCount, 5);
    assert.deepEqual(list.clients.find(row => row.email === guest), { email: guest, bookingCount: 3 });
    const paged = [];
    for (let offset = 0; offset < list.totalCount; offset++) {
      const page = await rt.data(`/api/app/clients?limit=1&offset=${offset}`);
      assert.equal(page.totalCount, list.totalCount); paged.push(...page.clients);
    }
    assert.deepEqual(paged, list.clients);
    for (const [offset, expected] of [[0, ids.slice(0, 2)], [2, ids.slice(2)], [3, []]]) {
      const page = await rt.data(historyPath(guest) + `&limit=2&offset=${offset}`);
      assert.equal(page.totalCount, 3); assert.deepEqual(page.bookings.map(row => row.id), expected);
    }
    for (const path of ['/api/app/clients', historyPath(guest)]) {
      const denied = await rt.api(path, { headers: { cookie: '' } });
      assert.equal(denied.status, 401); await denied.arrayBuffer();
    }
    const bookingsBefore = (await rt.db.prepare('SELECT * FROM bookings ORDER BY id').all()).results;
    // Neither guest address needs a pre-existing annotation profile to merge.
    await rt.data('/api/app/clients/merge', { source: alias, target: guest });
    await rt.data('/api/app/clients/notes', { email: alias, body: 'Guest preparation' }, 201);
    await rt.data('/api/app/clients/fields', { email: guest, label: 'Guest reference', value: 'synthetic-dial-206' }, 201);
    await rt.data('/api/app/clients/notes', { email: primaries[0], body: 'Primary preparation' }, 201);
    await rt.data('/api/app/clients/fields', { email: primaries[0], label: 'Primary reference', value: 'synthetic-dial-207' }, 201);
    await rt.data('/api/app/clients/merge', { source: primaries[0], target: guest });
    const merged = await history(guest);
    assert.equal(merged.totalCount, 3, 'primary and two guest aliases on one booking count once');
    assert.deepEqual(merged.bookings, initial.bookings);
    assert.deepEqual(merged.aliases, [guest, alias, primaries[0]].sort());
    assert.deepEqual(merged.notes.map(row => row.body).sort(), ['Guest preparation', 'Primary preparation']);
    assert.deepEqual(merged.fields.map(row => row.value).sort(), ['synthetic-dial-206', 'synthetic-dial-207']);
    for (const email of merged.aliases) assert.deepEqual(await history(email), merged);
    const after = await rt.data('/api/app/clients');
    assert.equal(after.totalCount, 3);
    assert.deepEqual(after.clients.find(row => row.email === guest), { email: guest, bookingCount: 3 });
    const mergedPages = [];
    for (let offset = 0; offset < 4; offset++) {
      const page = await rt.data(historyPath(alias) + `&limit=1&offset=${offset}`);
      assert.equal(page.totalCount, 3); mergedPages.push(...page.bookings.map(row => row.id));
    }
    assert.deepEqual(mergedPages, ids, 'merged primary and guest participation cannot duplicate or displace a later page');
    assert.deepEqual((await rt.db.prepare('SELECT * FROM bookings ORDER BY id').all()).results, bookingsBefore);
    const actor = (await rt.data('/api/app/session')).operator.id;
    assert.ok((await rt.db.prepare("SELECT actor_id FROM anonymized_audit WHERE entity_kind='client' AND action='merged'").all()).results.every(row => row.actor_id === actor));
    const snapshot = async () => Object.fromEntries(await Promise.all(['client_profiles', 'client_aliases', 'client_notes', 'client_fields', 'anonymized_audit'].map(async table => [table, (await rt.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
    const beforeRefused = await snapshot();
    await rt.data('/api/app/clients/merge', { source: alias, target: guest }, 409);
    await rt.data('/api/app/clients/merge', { source: guest, target: address(999) }, 404);
    await rt.data('/api/app/clients/notes', { email: address(999), body: 'Unknown client' }, 404);
    await rt.data('/api/app/clients/fields', { email: address(999), label: 'Unknown reference', value: 'synthetic-dial-217' }, 409);
    assert.deepEqual(await snapshot(), beforeRefused);
    for (const [path, body] of [
      ['/api/app/clients/notes', { email: guest, body: 'Anonymous preparation' }],
      ['/api/app/clients/fields', { email: guest, label: 'Anonymous reference', value: 'synthetic-dial-218' }],
      ['/api/app/clients/merge', { source: primaries[1], target: guest }],
    ]) {
      const response = await rt.api(path, { method: 'POST', headers: { cookie: '', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 401); await response.arrayBuffer();
      assert.deepEqual(await snapshot(), beforeRefused, 'anonymous mutations cannot change guest annotations or merge identities');
    }
    await rt.db.prepare('INSERT INTO person_erasure_locks(email,requested_at) VALUES(?,?)').bind(alias, new Date().toISOString()).run();
    for (const [path, body] of [
      ['/api/app/clients/notes', { email: guest, body: 'Refused pending erasure' }],
      ['/api/app/clients/fields', { email: guest, label: 'Refused reference', value: 'synthetic-dial-208' }],
      ['/api/app/clients/merge', { source: primaries[1], target: guest }],
    ]) {
      const refused = await rt.api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.ok(refused.status >= 400); await refused.arrayBuffer();
      assert.deepEqual(await snapshot(), beforeRefused, 'an erasure lock on any alias fences every client mutation');
    }
    await rt.db.prepare('DELETE FROM person_erasure_locks WHERE email=?').bind(alias).run();
    const remember = '/api/public/book/dial-host/intro/remember';
    const publicPost = async (path, body, expected) => {
      const response = await rt.api(path, { method: 'POST', headers: { cookie: '', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, expected); return response.json();
    };
    const acknowledgement = await publicPost(remember + '/request', { email: guest }, 202);
    assert.deepEqual(await publicPost(remember + '/request', { email: alias }, 202), acknowledgement);
    assert.deepEqual(await publicPost(remember + '/request', { email: address(999) }, 202), acknowledgement);
    const mail = async () => (await rt.db.prepare("SELECT payload_json FROM delivery_outbox WHERE json_extract(payload_json,'$.clientRememberId') IS NOT NULL").all()).results;
    assert.deepEqual(await mail(), [], 'guest membership and a merge grant no primary invitee details');
    assert.deepEqual(await publicPost(remember + '/request', { email: primaries[0] }, 202), acknowledgement);
    const [message] = (await mail()).map(row => JSON.parse(row.payload_json));
    assert.equal(message.to, primaries[0]);
    const token = new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('remember');
    await publicPost(remember + '/redeem', { email: guest }, 400);
    const saved = await publicPost(remember + '/redeem', { token }, 200);
    assert.deepEqual(saved, { name: 'Primary person 0', email: primaries[0], answers: { [event.questions[0].key]: 'Private primary answer 0' } });
    await publicPost(remember + '/redeem', { token }, 404);
    context.diagnostic('PROBE CLIENT-001 guest history: three public confirmations -> one guest client, three distinct entries; merged aliases retain three entries, two notes and two fields; list and history pagination agree.');
    context.diagnostic('PROBE CLIENT-001 authority: anonymous history -> 401; guest remembered-details requests -> uniform 202 and no mail; primary mailed capability -> only its own answers, replay 404; alias erasure lock -> mutations refused without changes.');
    context.diagnostic('PROBE CLIENT-001 guest erasure: guest-only preview claims zero primary bookings; confirmation removes three guest history entries and annotations, preserving primary bookings and control client history.');
  } finally { await rt.close(); }
});
