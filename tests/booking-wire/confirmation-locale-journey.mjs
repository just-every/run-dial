import assert from 'node:assert/strict';
import { bookingMail, recipient, textBody, htmlBody, timeRange } from './mail-contracts.mjs';

/** Exercise the saved language through native owner configuration, public confirmation and real mail transport. */
export async function confirmationLocaleJourney({ data, call, state, deliver, future, checks }) {
  const origin = process.env.DIAL_REVIEW_ORIGIN;
  const title = 'Studio <script> & "Planning"';
  const locationLabel = 'Meeting room <West> & studio';
  const locationValue = '42 Artist Lane <Suite A> & annex';
  const privateAnswer = 'PRIVATE_SYNTHETIC_DIAL_LOCALE_1601 <script> & "note"';
  const publicAnswer = 'Keep my English answer <North> & "East"';
  const eventInput = slug => ({
    slug, title, description: 'Operator description stays in English.', durationMinutes: 30,
    color: '#176b5a', locationType: 'in_person', locationLabel, locationValue,
    listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30,
    minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0,
    afterBufferMinutes: 0, hostDayBookingLimit: null,
    questions: [
      { kind: 'text', label: 'Project goals <Draft> & plan', required: true, private: false, options: [] },
      { kind: 'text', label: 'Private note <Owner> & detail', required: true, private: true, options: [] },
    ],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 780, endMinute: 1080 })),
  });
  const languagePath = event => `/api/app/event-types/${event.id}/confirmation-language`;
  const saveLanguage = (event, confirmationLanguage) => data(languagePath(event), { confirmationLanguage }, 200, 'PUT');
  const control = (name, value) => data('/wire/control', { name, value });
  const applicationRows = snapshot => Object.fromEntries(Object.entries(snapshot).filter(([table]) => !table.startsWith('wire_')));
  const spanishRange = (occurrence, zone, numericUtcOffset = false) => {
    const formatter = new Intl.DateTimeFormat('es-US', {
      timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      hour12: true, timeZoneName: numericUtcOffset ? 'longOffset' : 'shortOffset',
    });
    const format = value => numericUtcOffset
      ? formatter.formatToParts(new Date(value)).map(part => part.type === 'timeZoneName'
        ? part.value === 'GMT' ? 'UTC+00:00' : part.value.replace('GMT', 'UTC') : part.value).join('')
      : formatter.format(new Date(value));
    return `${format(occurrence.startAt)}–${format(occurrence.endAt)} (${zone})`;
  };
  const escape = value => value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  await control('mail-ambiguous', 0);
  await call('/api/app/calendar/connection', undefined, 204, 'DELETE');
  const event = await data('/api/app/event-types', eventInput('synthetic-dial-confirmation-locale'), 201);
  const englishEvent = await data('/api/app/event-types', eventInput('synthetic-dial-confirmation-english'), 201);
  assert.deepEqual(await data(languagePath(event)), { confirmationLanguage: 'en' }, 'new ordinary events default to English');
  assert.deepEqual(await data(languagePath(englishEvent)), { confirmationLanguage: 'en' });
  const beforeRefusal = applicationRows(await state());
  for (const unsupported of ['fr', 'ES', '', null, ['es']]) {
    await call(languagePath(event), { confirmationLanguage: unsupported }, 400, 'PUT');
  }
  await call(languagePath(event), { confirmationLanguage: 'es', unexpected: true }, 400, 'PUT');
  const anonymous = await fetch(origin + languagePath(event), {
    method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ confirmationLanguage: 'es' }),
  });
  assert.equal(anonymous.status, 401); await anonymous.arrayBuffer();
  const anonymousRead = await fetch(origin + languagePath(event));
  assert.equal(anonymousRead.status, 401); await anonymousRead.arrayBuffer();
  assert.deepEqual(applicationRows(await state()), beforeRefusal, 'invalid and anonymous language requests change no application row');
  assert.deepEqual(await saveLanguage(event, 'es'), { confirmationLanguage: 'es' });
  const updated = await data(`/api/app/event-types/${event.id}/details`, {
    ...event, description: 'An ordinary edit keeps the confirmation language.', availability: undefined, alternativeRequestsEnabled: undefined,
  }, 200, 'PATCH');
  assert.equal(updated.description, 'An ordinary edit keeps the confirmation language.');
  assert.deepEqual(await data(languagePath(event)), { confirmationLanguage: 'es' });
  const copy = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.equal(copy.status, 'draft');
  assert.deepEqual(await data(languagePath(copy)), { confirmationLanguage: 'es' }, 'draft duplication preserves the event language');
  await saveLanguage(copy, 'en');
  assert.deepEqual(await data(languagePath(event)), { confirmationLanguage: 'es' }, 'copy and original language settings remain independent');
  for (const chosen of [event, englishEvent]) await data(`/api/app/event-types/${chosen.id}/publish`, {});

  async function book(chosen, number, inviteeTimezone = 'America/Los_Angeles') {
    const base = `/api/public/book/dial-host/${chosen.slug}`;
    const slot = (await data(`${base}/availability?week=${future}`)).slots[0]; assert.ok(slot);
    const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone }, 201);
    const email = [`synthetic-dial-${number}`, 'example.test'].join('@');
    const input = {
      nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone, name: 'Taylor <Artist> & Morgan', email,
      answers: { [chosen.questions[0].key]: publicAnswer, [chosen.questions[1].key]: number === 1601 ? privateAnswer : `Control note ${number}` },
    };
    const receipt = await data(`${base}/confirm`, input, 201);
    await data(`${base}/confirm`, input, 200);
    const snapshot = await state(), booking = snapshot.bookings.find(row => row.id === receipt.bookingReference);
    assert.ok(booking); assert.equal(booking.calendar_required, 0);
    assert.equal(snapshot.bookings.filter(row => row.id === booking.id).length, 1);
    const outbox = snapshot.delivery_outbox.filter(row => row.booking_id === booking.id && row.kind === 'mail_send');
    assert.equal(outbox.length, 2, 'nonce replay creates only the invitee and host confirmation commands');
    return { base, input, receipt, booking, outbox, email };
  }

  const english = await book(englishEvent, 1600);
  await deliver();
  const englishMail = bookingMail(await state(), english.booking.id).filter(mail => recipient(mail).includes(english.email));
  assert.equal(englishMail.length, 1);
  assert.equal(englishMail[0].subject, `Confirmed: ${title}`);
  assert.ok(textBody(englishMail[0]).includes(`${title} with Morgan Bell`));
  assert.ok(textBody(englishMail[0]).includes('Duration: 30 minutes'));
  assert.ok(htmlBody(englishMail[0]).includes('<html lang="en">'));
  assert.ok(htmlBody(englishMail[0]).includes('Your booking is confirmed.'));
  assert.ok(htmlBody(englishMail[0]).includes('Sent by Dial'));
  assert.ok(textBody(englishMail[0]).includes(timeRange(english.receipt.occurrence.startAt, english.receipt.occurrence.endAt, 'America/Los_Angeles')));

  const spanish = await book(event, 1601);
  const inviteeCommand = spanish.outbox.find(row => JSON.parse(row.payload_json).recipientRole === 'invitee');
  assert.equal(JSON.parse(inviteeCommand.payload_json).confirmationLanguage, 'es', 'the event language is snapshotted when the confirmation is queued');
  // Change the setting before the first delivery, then change branding after a rejected first attempt.
  await saveLanguage(event, 'en');
  await control(`mail-rate-limited:${spanish.email}`, 1);
  await deliver();
  let snapshot = await state();
  const first = bookingMail(snapshot, spanish.booking.id).filter(mail => recipient(mail).includes(spanish.email));
  assert.equal(first.length, 1);
  assert.equal(first[0].subject, `Reserva confirmada: ${title}`);
  const text = textBody(first[0]), html = htmlBody(first[0]);
  assert.deepEqual(first[0].content.map(part => part.type), ['text/plain', 'text/html']);
  assert.ok(text.includes(`${title} con Morgan Bell`));
  assert.ok(html.includes('<html lang="es">'));
  assert.ok(html.includes('Tu reserva está confirmada.'));
  for (const label of ['Evento', 'Hora del invitado', 'Hora del anfitrión', 'Duración', 'Ubicación']) {
    assert.ok(text.includes(label), `Spanish plain confirmation includes ${label}`);
    assert.ok(html.includes(label), `Spanish HTML confirmation includes ${label}`);
  }
  assert.ok(text.includes('30 minutos')); assert.ok(html.includes('30 minutos'));
  for (const zone of ['America/Los_Angeles', 'Australia/Brisbane']) {
    const range = spanishRange(spanish.receipt.occurrence, zone);
    assert.ok(text.includes(range), `Spanish text contains the exact local date, 12-hour range and ${zone}`);
    assert.ok(html.includes(range), `Spanish HTML contains the same local range and ${zone}`);
    assert.match(range, /[ap]\.\s*m\.|[AP]M/u, 'Spanish date rendering explicitly uses a 12-hour day period');
  }
  for (const value of [title, locationLabel, locationValue, event.questions[0].label, event.questions[1].label, publicAnswer, privateAnswer]) {
    assert.ok(text.includes(value), 'operator text remains as entered in the plain confirmation');
    assert.ok(html.includes(escape(value)), 'operator text remains as entered and HTML escaped in the confirmation');
  }
  assert.ok(!html.includes('<script>'));
  assert.ok(text.includes(`Gestionar esta reserva: ${spanish.receipt.manageUrl}`));
  assert.ok(html.includes(`href="${spanish.receipt.manageUrl}"`));
  assert.ok(html.includes('Gestionar reserva'));
  assert.ok(text.includes('Añadir al calendario: ')); assert.ok(html.includes('Añadir al calendario'));
  assert.ok(text.includes('Enviado por Dial')); assert.ok(html.includes('Enviado por Dial'));
  for (const englishString of ['Your booking is confirmed.', 'Invitee time', 'Host time', 'Duration:', 'Location:', 'Manage booking', 'Manage this booking:', 'Add to calendar', 'Sent by Dial']) {
    assert.ok(!text.includes(englishString) && !html.includes(englishString), `Spanish built-in mail has no English system text: ${englishString}`);
  }
  const ownerMail = bookingMail(snapshot, spanish.booking.id).filter(mail => !recipient(mail).includes(spanish.email));
  assert.equal(ownerMail.length, 1);
  assert.equal(ownerMail[0].subject, `New booking: ${title}`);
  assert.ok(htmlBody(ownerMail[0]).includes('<html lang="en">'), 'the invitee language does not translate host mail');
  assert.ok(!JSON.stringify(ownerMail[0]).includes(spanish.receipt.manageUrl), 'host mail receives no invitee manage authority');
  await data('/api/app/site-look', { name: 'Changed brand <Later>', accent: '#6b234d', look: 'site' }, 200, 'PUT');
  await call('/__fixtures/due', { id: inviteeCommand.id }, 204);
  await deliver(); snapshot = await state();
  const attempts = bookingMail(snapshot, spanish.booking.id).filter(mail => recipient(mail).includes(spanish.email));
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], first[0], 'delivery retries preserve the complete provider request after language and brand changes');
  const sent = snapshot.wire_calls.length;
  await data('/__fixtures/deliver', { id: inviteeCommand.id }); await deliver();
  assert.equal((await state()).wire_calls.length, sent, 'successful replay sends no additional confirmation');

  // The existing locked-zone guarantees also apply to localized confirmation content.
  await saveLanguage(event, 'es');
  await data(`/api/app/event-types/${event.id}/booking-policy`, { lockedTimezone: 'America/New_York' }, 200, 'PUT');
  const locked = await book(event, 1602, 'Europe/Paris');
  await deliver();
  const lockedMail = bookingMail(await state(), locked.booking.id).filter(mail => recipient(mail).includes(locked.email));
  assert.equal(lockedMail.length, 1);
  for (const body of [textBody(lockedMail[0]), htmlBody(lockedMail[0])]) {
    assert.ok(body.includes('Hora'));
    assert.ok(body.includes('Hora del navegador'));
    // ICU versions differ only in the width of the space before Spanish day periods.
    const displayed = body.replace(/\s/gu, ' ');
    for (const zone of ['America/New_York', 'Europe/Paris']) {
      assert.ok(displayed.includes(spanishRange(locked.receipt.occurrence, zone, true).replace(/\s/gu, ' ')), `locked Spanish confirmation preserves the exact date, 12-hour time, UTC offset and ${zone}`);
    }
    assert.ok(!body.includes('America/Los_Angeles') && !body.includes('Australia/Brisbane'), 'locked mail cannot silently fall back to invitee or host timezone');
  }
  snapshot = await state();
  const controlIds = [english.booking.id, locked.booking.id];
  const controls = source => Object.fromEntries(['bookings', 'booking_occurrences', 'booking_history', 'delivery_outbox', 'delivery_attempts', 'base_mail_dispatch'].map(table => [table, source[table].filter(row => controlIds.includes(row.id) || controlIds.includes(row.booking_id) || controlIds.includes(row.occurrence_id) || [english, locked].some(controlBooking => controlBooking.outbox.some(outbox => outbox.id === row.outbox_id || outbox.idempotency_key === row.delivery_id)))]));
  const beforeErasure = controls(snapshot);
  assert.ok(snapshot.delivery_outbox.some(row => row.booking_id === spanish.booking.id && row.payload_json.includes('PRIVATE_SYNTHETIC_DIAL_LOCALE_1601')), 'the populated localized mail contains the private answer before erasure');
  const preview = await data('/api/app/privacy/preview', { email: spanish.email });
  await data('/api/app/privacy/erase', { email: spanish.email, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  snapshot = await state();
  assert.equal(snapshot.bookings.some(row => row.id === spanish.booking.id), false);
  assert.equal(snapshot.delivery_outbox.some(row => row.booking_id === spanish.booking.id), false);
  assert.ok(!JSON.stringify(applicationRows(snapshot)).includes('PRIVATE_SYNTHETIC_DIAL_LOCALE_1601'), 'erasure removes localized private mail from every application table');
  assert.ok(!JSON.stringify(applicationRows(snapshot)).includes(spanish.email), 'erasure removes the localized recipient from every application table');
  assert.deepEqual(controls(snapshot), beforeErasure, 'erasure preserves both English and Spanish control bookings and mail');
  const afterEraseCalls = snapshot.wire_calls.length;
  await data('/__fixtures/deliver', { id: inviteeCommand.id }); await deliver();
  assert.equal((await state()).wire_calls.length, afterEraseCalls, 'replayed erased localized mail cannot send again');
  await call(new URL(spanish.receipt.manageUrl).pathname.replace('/manage/', '/api/public/manage/'), undefined, [404, 410]);
  const beforeRevocation = applicationRows(await state());
  await call('/auth/signout', {}, 204);
  await call(languagePath(event), { confirmationLanguage: 'en' }, 401, 'PUT');
  await call(languagePath(event), undefined, 401);
  assert.deepEqual(applicationRows(await state()), beforeRevocation, 'a revoked owner session cannot read or change event language or queue content');
  checks.push('LOCALE-001 Spanish built-in confirmation: owner configuration, English defaults and unsupported refusal; public nonce replay, exact Spanish MIME content with 12-hour local and locked zones, unchanged escaped operator text, independent draft copy and ordinary edits, queued-language snapshot, frozen retry after language and brand changes, owner authority revocation and localized person erasure with intact control records.');
}
