import assert from "node:assert/strict";
import { assertTimeRange, assertActionParity, assertChange, htmlBody, recipient, textBody, timeRange, wireMail } from "./mail-contracts.mjs";

export async function manageRotationJourney({ data, call, state, book, future, checks }) {
  const email = "manage-rotation@dial.test";
  const first = await book(0, { name: "Manage rotation guest", email });
  let snapshot = await state();
  const booking = snapshot.bookings.find(row => row.invitee_email === email);
  assert.ok(booking);
  const invitation = findOutbox(snapshot, booking.id, row => {
    const payload = parsePayload(row);
    return row.kind === "mail_send" && payload.to === email && payload.subject?.startsWith("Confirmed:");
  });
  const operatorInvitation = findOutbox(snapshot, booking.id, row => {
    const payload = parsePayload(row);
    return row.kind === "mail_send" && payload.to === "operator@dial.test" && payload.subject?.startsWith("New booking:");
  });
  const calendar = findOutbox(snapshot, booking.id, row => row.kind === "calendar_upsert");
  await data("/__fixtures/deliver", { id: calendar.id });
  snapshot = await state();
  const defaultInvitation = snapshot.wire_calls.find(row => row.method === "POST" && new URL(row.url).pathname.includes("/events") && JSON.parse(row.body).extendedProperties?.private?.["dial-booking-id"] === booking.id);
  assert.ok(JSON.parse(defaultInvitation.body).description.includes("/manage/invite/"), "NOTIFY-009: unconfigured offers include invitation access by default");
  const linkReady = findOutbox(snapshot, booking.id, row => row.kind === "mail_send" && parsePayload(row).subject === "Your meeting link is ready");

  const revokedInitial = first.receipt.manageUrl;
  assert.equal(parsePayload(linkReady).manageUrl === revokedInitial, true, "the link-ready fixture queues the pre-rotation snapshot capability");
  const firstRotation = await data(`/api/app/bookings/${booking.id}/manage-link/rotate`, {});
  assert.equal(firstRotation.manageUrl === revokedInitial, false, "operator rotation creates a replacement capability");
  snapshot = await state();
  const queuedInvitation = parsePayload(snapshot.delivery_outbox.find(row => row.id === invitation.id));
  assert.equal(queuedInvitation.manageUrl === firstRotation.manageUrl, true, "rotation updates the pending invitee payload");
  assert.equal(queuedInvitation.text.includes(revokedInitial), true, "fixture retains the revoked action line until first dispatch");
  assert.equal(queuedInvitation.html.includes(`href="${revokedInitial}"`), true, "fixture retains the revoked HTML action until first dispatch");

  await data("/__fixtures/deliver", { id: invitation.id });
  await data("/__fixtures/deliver", { id: linkReady.id });
  await data("/__fixtures/deliver", { id: operatorInvitation.id });
  snapshot = await state();
  const confirmationWire = sentMail(snapshot, `Confirmed: ${first.receipt.event.eventTitle}`, email);
  const linkReadyWire = sentMail(snapshot, "Your meeting link is ready", email);
  const operatorWire = sentMail(snapshot, `New booking: ${first.receipt.event.eventTitle}`, "operator@dial.test");
  assertCurrentActions(confirmationWire, firstRotation.manageUrl, revokedInitial);
  assertCurrentActions(linkReadyWire, firstRotation.manageUrl, revokedInitial);
  assert.deepEqual(recipient(linkReadyWire), [email], "link-ready retains its existing invitee-only recipient contract");
  assert.deepEqual(recipient(operatorWire), ["operator@dial.test"]);
  assert.equal(JSON.stringify(operatorWire).includes(new URL(firstRotation.manageUrl).pathname.split("/").at(-1)), false, "operator copy contains no invitee capability");
  assert.deepEqual(confirmationWire.content.map(part => part.type), ["text/plain", "text/html"]);
  assert.deepEqual(linkReadyWire.content.map(part => part.type), ["text/plain", "text/html"]);

  const frozenBeforeRotation = new Map([invitation.id, linkReady.id, operatorInvitation.id].map(id => {
    const row = snapshot.delivery_outbox.find(item => item.id === id);
    const wire = parsePayload(row).wireMail;
    assert.ok(wire, "the first attempt freezes the exact provider message");
    return [id, JSON.stringify(wire)];
  }));
  const sendCountBeforeReplay = wireMail(snapshot).length;
  const secondRotation = await data(`/api/app/bookings/${booking.id}/manage-link/rotate`, {});
  snapshot = await state();
  for (const [id, frozen] of frozenBeforeRotation) {
    const current = JSON.stringify(parsePayload(snapshot.delivery_outbox.find(row => row.id === id)).wireMail);
    assert.equal(current === frozen, true, "a post-attempt token rotation preserves the exact frozen provider bytes");
  }
  for (const id of [invitation.id, linkReady.id, operatorInvitation.id]) await data("/__fixtures/deliver", { id });
  assert.equal(wireMail(await state()).length, sendCountBeforeReplay, "a completed first attempt is not replayed after capability rotation");

  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${future}`);
  const initialOccurrence = snapshot.booking_occurrences.find(row => row.id === booking.current_occurrence_id);
  const nextSlot = availability.slots.find(slot => slot.startAt !== initialOccurrence.start_at);
  assert.ok(nextSlot, "the operator reschedule fixture selects a free current event slot");
  const reason = "Operator timezone update";
  const changed = await data(`/api/app/bookings/${booking.id}/reschedule`, {
    startAt: nextSlot.startAt,
    inviteeTimezone: "America/New_York",
    reason,
    overridePublishedAvailability: false,
  });
  assert.equal(changed.inviteeTimezone, "America/New_York");
  snapshot = await state();
  const inviteeChange = findOutbox(snapshot, booking.id, row => {
    const payload = parsePayload(row);
    return row.kind === "mail_send" && payload.to === email && payload.subject?.startsWith("Rescheduled:");
  });
  const operatorChange = findOutbox(snapshot, booking.id, row => {
    const payload = parsePayload(row);
    return row.kind === "mail_send" && payload.to === "operator@dial.test" && payload.subject?.startsWith("Rescheduled:");
  });
  const queuedChange = parsePayload(inviteeChange);
  assert.equal(queuedChange.manageUrl === secondRotation.manageUrl, true, "reschedule composes its action from the current capability");
  const thirdRotation = await data(`/api/app/bookings/${booking.id}/manage-link/rotate`, {});
  snapshot = await state();
  assert.equal(parsePayload(snapshot.delivery_outbox.find(row => row.id === inviteeChange.id)).manageUrl === thirdRotation.manageUrl, true, "the third rotation updates the unfrozen reschedule payload");
  await data("/__fixtures/deliver", { id: inviteeChange.id });
  await data("/__fixtures/deliver", { id: operatorChange.id });
  snapshot = await state();
  assertChange(snapshot, first.receipt, changed, email, "reschedule", reason, "an operator", booking.id);
  const rescheduleWire = sentMail(snapshot, `Rescheduled: ${first.receipt.event.eventTitle}`, email);
  assertCurrentActions(rescheduleWire, thirdRotation.manageUrl, secondRotation.manageUrl);
  assert.equal(recipient(sentMail(snapshot, `Rescheduled: ${first.receipt.event.eventTitle}`, "operator@dial.test")).length, 1);
  const previousTime = timeRange(first.receipt.occurrence.startAt, first.receipt.occurrence.endAt, "UTC");
  const nextTime = timeRange(changed.occurrence.startAt, changed.occurrence.endAt, "America/New_York");
  assertTimeRange(textBody(rescheduleWire), htmlBody(rescheduleWire), previousTime, "Previous invitee time: ");
  assertTimeRange(textBody(rescheduleWire), htmlBody(rescheduleWire), nextTime, "New invitee time: ");

  snapshot = await state();
  const reminder = findOutbox(snapshot, booking.id, row => {
    const payload = parsePayload(row);
    return row.kind === "reminder" && row.occurrence_id === changed.occurrence.id && payload.to === email;
  });
  await call("/__fixtures/due", { id: reminder.id }, 204);
  await data("/__fixtures/deliver", { id: reminder.id });
  snapshot = await state();
  const reminderWire = sentMail(snapshot, `Reminder: ${first.receipt.event.eventTitle}`, email);
  assertCurrentActions(reminderWire, thirdRotation.manageUrl, secondRotation.manageUrl);
  // C.1 compares the new recipient zone using the reminder's existing en-GB long-date format.
  const reminderFormat = instant => new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }).format(new Date(instant));
  const reminderRange = `${reminderFormat(changed.occurrence.startAt)} – ${reminderFormat(changed.occurrence.endAt)} (America/New_York)`;
  assert.ok(textBody(reminderWire).includes(reminderRange));
  assert.ok(htmlBody(reminderWire).includes(reminderRange));

  const legacy = await data("/wire/legacy-mail", { bookingId: booking.id });
  await data("/wire/control", { name: "mail-rejected", value: 1 });
  await data("/__fixtures/deliver", { id: legacy.id });
  snapshot = await state();
  const failedLegacy = snapshot.delivery_outbox.find(row => row.id === legacy.id);
  const failedPayload = parsePayload(failedLegacy);
  assert.equal(failedLegacy.state, "failed");
  assert.equal(failedLegacy.last_error_code, "permanent_delivery_failure");
  assert.equal(Object.hasOwn(failedPayload, "html"), false, "freezing a pre-C.1 plain-only row preserves HTML absence");
  assert.equal(Object.hasOwn(failedPayload.wireMail, "html"), false, "the frozen first attempt remains text-only");
  assert.equal(snapshot.base_mail_dispatch.find(row => row.delivery_id === failedLegacy.idempotency_key)?.state, "rejected", "the local provider's actual 403 response follows the production rejected path");
  const rejectedWire = sentMail(snapshot, "Legacy plain retry", email);
  assert.deepEqual(rejectedWire.content.map(part => part.type), ["text/plain"], "the rejected provider request remains a legacy plain-only message");
  const retryResponse = await call(`/api/app/bookings/${booking.id}/deliveries/${legacy.id}/retry`, {}, 202);
  const retry = await retryResponse.json();
  await data("/__fixtures/deliver", { id: retry.id });
  snapshot = await state();
  const retried = snapshot.delivery_outbox.find(row => row.id === retry.id);
  const retriedPayload = parsePayload(retried);
  assert.equal(retried.state, "succeeded");
  assert.equal(Object.hasOwn(retriedPayload, "html"), false, "recovery preserves absent HTML instead of writing JSON null");
  assert.equal(Object.hasOwn(retriedPayload.wireMail, "html"), false);
  assert.equal(retriedPayload.wireMail.text, "Legacy plain body");
  assert.equal(snapshot.base_mail_dispatch.find(row => row.delivery_id === retried.idempotency_key)?.state, "accepted");
  const legacyWires = wireMail(snapshot).filter(mail => mail.subject === "Legacy plain retry" && recipient(mail).includes(email));
  assert.equal(legacyWires.length, 2, "one rejected request is followed by one explicit retry");
  for (const mail of legacyWires) {
    assert.deepEqual(mail.content.map(part => part.type), ["text/plain"]);
    assert.equal(textBody(mail), "Legacy plain body");
  }
  checks.push("production confirmation, link-ready, reschedule, and freshly composed reminder resolve the active manage/ICS URLs before first freeze; later rotation preserves frozen bytes; operator reschedule carries the previous UTC and new America/New_York times");
  checks.push("legacy plain-only first attempt is rejected once by local SendGrid, then production recovery retries text-only without JSON-null HTML");
}

function findOutbox(snapshot, bookingId, predicate) {
  const row = snapshot.delivery_outbox.find(item => item.booking_id === bookingId && predicate(item));
  assert.ok(row, "the production transaction queued the expected booking delivery");
  return row;
}

function parsePayload(row) {
  return JSON.parse(row.payload_json);
}

function sentMail(snapshot, subject, email) {
  const mail = wireMail(snapshot).find(item => item.subject === subject && recipient(item).includes(email));
  assert.ok(mail, "the production delivery reached the local SendGrid wire fixture");
  return mail;
}

function assertCurrentActions(mail, currentManageUrl, revokedManageUrl) {
  const body = textBody(mail);
  const html = htmlBody(mail);
  const calendarUrl = new URL(currentManageUrl);
  calendarUrl.pathname = calendarUrl.pathname.replace(/^\/manage\//u, "/api/public/manage/") + "/calendar.ics";
  assertActionParity(body, html);
  assert.ok(body.includes(`Manage this booking: ${currentManageUrl}`));
  assert.ok(body.includes(`Add to calendar: ${calendarUrl.toString()}`));
  assert.ok(html.includes(`href="${currentManageUrl}"`));
  assert.ok(html.includes(`href="${calendarUrl.toString()}"`));
  assert.equal(body.includes(revokedManageUrl), false, "plain text omits the revoked manage and calendar capability");
  assert.equal(html.includes(revokedManageUrl), false, "HTML omits the revoked manage and calendar capability");
}
