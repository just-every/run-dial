import { evidencePath } from "../../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { authenticate, call, control, data, deliver, due, origin, payload, preferences, processOne, providerId, sentKeys, setMuted, snapshot } from "./helpers.mjs";

export async function verifyBeforeRestart() {
  const checks = [], proofs = [], skippedKeys = [];
  const mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
  const fixture = await data("/__fixtures/setup", {});
  const { operator: second } = await data("/__fixtures/preferences/operators", {});
  const firstEmail = fixture.operatorEmail, secondEmail = second.email;
  await authenticate(firstEmail); await authenticate(secondEmail);
  await call("/api/app/mail/preferences", undefined, 401);
  await call("/api/app/mail/preferences", { bookingMailMuted: true }, 401, undefined, "PUT");
  await call("/api/app/mail/preferences", { bookingMailMuted: true }, 403, firstEmail, "PUT", { Origin: "https://forged.example.test" });
  for (const body of [{}, { bookingMailMuted: "true" }, { bookingMailMuted: null }, { bookingMailMuted: true, operatorId: second.id }]) await call("/api/app/mail/preferences", body, 400, firstEmail, "PUT");
  assert.deepEqual(await preferences(firstEmail), { bookingMailMuted: false }); assert.deepEqual(await preferences(secondEmail), { bookingMailMuted: false });
  await setMuted(secondEmail, true); assert.deepEqual(await preferences(firstEmail), { bookingMailMuted: false });
  await setMuted(secondEmail, false);
  mark("preferences require native sessions and valid origins; strict boolean input refuses forged identity and keeps two operators independent");

  const event = await data("/api/public/events/dial-host/intro");
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 2 * 86400000); assert.ok(slots.length > 30);
  async function create(index, email, name) {
    const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[index].startAt, inviteeTimezone: "UTC" }, 201);
    await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slots[index].startAt, inviteeTimezone: "UTC", name, email, answers: { [event.eventType.questions[0].key]: "Synthetic preferences fixture" } }, 201);
    return (await snapshot()).bookings.find((row) => row.invitee_name === name);
  }
  const booking = await create(0, firstEmail, "Muted operator as invitee");
  function bookingNotices(state, occurrenceId, kind = "mail_send") {
    return state.delivery_outbox.filter((row) => row.booking_id === booking.id && row.occurrence_id === occurrenceId && row.kind === kind && ["operator", "invitee"].includes(payload(row).recipientRole));
  }
  async function proveDelivery(rows, phase) {
    assert.equal(rows.length, 3);
    const state = await snapshot(), effects = sentKeys(state);
    for (const prior of rows) {
      const current = state.delivery_outbox.find((row) => row.id === prior.id), mail = payload(current);
      const muted = mail.recipientRole === "operator" && mail.to === firstEmail;
      const deliveryProviderId = providerId(state, current.id);
      assert.equal(current.state, "succeeded", "successful command completion may include intentional suppression");
      assert.equal(effects.has(current.idempotency_key), !muted);
      if (muted) {
        assert.equal(deliveryProviderId, null); assert.equal(current.payload_json, prior.payload_json, "mute leaves queued provider bytes unchanged");
        skippedKeys.push(current.idempotency_key);
      } else assert.ok(deliveryProviderId?.startsWith("synthetic-"));
      proofs.push({ phase, role: mail.recipientRole, recipient: mail.to, commandState: current.state, providerMessageId: deliveryProviderId, actualProviderEffect: effects.has(current.idempotency_key) });
    }
  }
  let queued = bookingNotices(await snapshot(), booking.current_occurrence_id);
  assert.ok(queued.every((row) => row.state === "pending"));
  await setMuted(firstEmail, true); await deliver(); await proveDelivery(queued, "confirmation");
  mark("muting after confirmations queue suppresses only that operator notice; the same address as invitee and the other operator still receive actual provider mail");

  await setMuted(firstEmail, false);
  await data(`/api/app/bookings/${booking.id}/reschedule`, { startAt: slots[8].startAt, inviteeTimezone: "UTC", overridePublishedAvailability: false }, 200, firstEmail);
  const moved = (await snapshot()).bookings.find((row) => row.id === booking.id);
  queued = bookingNotices(await snapshot(), moved.current_occurrence_id);
  await setMuted(firstEmail, true); await deliver(); await proveDelivery(queued, "reschedule");
  const reminders = bookingNotices(await snapshot(), moved.current_occurrence_id, "reminder").filter((row) => row.idempotency_key.includes(":reminder:60:"));
  assert.equal(reminders.length, 3);
  for (const reminder of reminders) await due(reminder.id);
  await proveDelivery(reminders, "reminder");
  mark("queued reschedule notices and current-occurrence reminders read mute at send time, while the same-email invitee reminder and unmuted operator send");

  await setMuted(firstEmail, false);
  await data(`/api/app/bookings/${booking.id}/cancel`, { reason: "Synthetic preference cancellation" }, 200, firstEmail);
  const cancelled = (await snapshot()).bookings.find((row) => row.id === booking.id);
  queued = bookingNotices(await snapshot(), cancelled.current_occurrence_id).filter((row) => payload(row).bookingState === "cancelled");
  await setMuted(firstEmail, true); await deliver(); await proveDelivery(queued, "cancellation");
  mark("queued cancellation mail also honors the operator's current preference without suppressing invitee or other-operator mail");

  const requestBody = { inviteeName: "Preferences request invitee", inviteeEmail: "preferences-request@dial.test", inviteeTimezone: "UTC", note: "Synthetic request while operator booking mail is muted", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
  const reviewed = await data("/api/public/events/dial-host/intro/request/review", requestBody, 201);
  await data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(reviewed.nonce)}`, requestBody, 201);
  await deliver(); let state = await snapshot();
  const request = state.availability_requests.find((row) => row.invitee_email === requestBody.inviteeEmail);
  const requestMail = state.delivery_outbox.filter((row) => row.request_id === request.id && row.kind === "mail_send");
  assert.equal(requestMail.length, 3); assert.ok(requestMail.every((row) => sentKeys(state).has(row.idempotency_key)));
  assert.ok(requestMail.some((row) => payload(row).to === firstEmail));
  const signinsBefore = state.fixture_mail.filter((row) => JSON.parse(row.message_json).subject === "Your sign-in link for Dial").length;
  assert.equal((await data("/__fixtures/preferences/signin", { email: firstEmail })).kind, "queued");
  state = await snapshot(); assert.equal(state.fixture_mail.filter((row) => JSON.parse(row.message_json).subject === "Your sign-in link for Dial").length, signinsBefore + 1);
  await data("/__fixtures/preferences/reconcile", {});
  // NOTIFY-007: the first failing check sights the incident; the confirmation after it alerts because the failure persisted.
  await control("check", true); await data("/__fixtures/preferences/reconcile", {}); await data("/__fixtures/preferences/reconcile", {}); await deliver();
  state = await snapshot();
  const alerts = state.delivery_outbox.filter((row) => row.idempotency_key.startsWith("connection:google_calendar:unhealthy:") && payload(row).to === firstEmail);
  assert.ok(alerts.length > 0); assert.ok(alerts.every((row) => sentKeys(state).has(row.idempotency_key)));
  await control("check"); await data("/__fixtures/preferences/reconcile", {}); await deliver();
  mark("muting booking mail leaves alternative-request acknowledgement/routing, actual synthetic sign-in mail and connection alerts enabled");

  await setMuted(firstEmail, false);
  const ambiguousBooking = await create(24, "ambiguous-preferences@dial.test", "Ambiguous preference retry");
  state = await snapshot();
  const ambiguous = state.delivery_outbox.find((row) => row.booking_id === ambiguousBooking.id && row.kind === "mail_send" && payload(row).recipientRole === "operator" && payload(row).to === firstEmail);
  await control("mail_after_accept", true); await processOne(ambiguous.id); await control("mail_after_accept");
  state = await snapshot();
  const failed = state.delivery_outbox.find((row) => row.id === ambiguous.id);
  assert.equal(failed.state, "failed"); assert.equal(failed.last_error_code, "provider_unavailable");
  assert.ok(payload(failed).wireMail); assert.ok(sentKeys(state).has(failed.idempotency_key));
  await setMuted(firstEmail, true);
  const retry = await data(`/api/app/bookings/${ambiguousBooking.id}/deliveries/${failed.id}/retry`, {}, 202, firstEmail);
  const retryBefore = (await snapshot()).delivery_outbox.find((row) => row.id === retry.id);
  assert.equal(payload(retryBefore).providerIdempotencyKey, failed.idempotency_key);
  assert.deepEqual(payload(retryBefore).wireMail, payload(failed).wireMail);
  await processOne(retry.id); state = await snapshot();
  const retryAfter = state.delivery_outbox.find((row) => row.id === retry.id);
  assert.equal(retryAfter.state, "succeeded"); assert.equal(providerId(state, retryAfter.id), null); assert.equal(retryAfter.payload_json, retryBefore.payload_json);
  assert.equal(state.fixture_mail.filter((row) => row.key === failed.idempotency_key).length, 1);
  await deliver();
  mark("muting an explicit retry of ambiguously accepted mail completes suppression without changing its frozen wire snapshot or original provider idempotency key");
  assert.deepEqual(await preferences(firstEmail), { bookingMailMuted: true }); assert.deepEqual(await preferences(secondEmail), { bookingMailMuted: false });
  await writeFile(evidencePath("mail-preferences-native.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, firstEmail, secondEmail, checks, proofs, skippedKeys, ambiguousBookingId: ambiguousBooking.id, originalFailedId: failed.id, retryId: retry.id, originalProviderKey: failed.idempotency_key }, null, 2) + "\n");
}
