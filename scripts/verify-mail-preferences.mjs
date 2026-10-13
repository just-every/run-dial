import { evidencePath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { verifyBeforeRestart } from "../tests/mail-preferences/before-restart.mjs";
import { authenticate, data, deliver, origin, payload, preferences, providerId, sentKeys, setMuted, snapshot } from "../tests/mail-preferences/helpers.mjs";

function assertFrozenProviderReceipt(state, row, label) {
  const mail = payload(row);
  assert.equal(row.state, "succeeded", `${label} command succeeded`);
  assert.equal(row.attempts, 1, `${label} command was attempted once`);
  const attempts = state.delivery_attempts.filter((attempt) => attempt.outbox_id === row.id);
  assert.equal(attempts.length, 1, `${label} has one recorded provider attempt`);
  assert.equal(attempts[0].outcome, "succeeded", `${label} provider attempt succeeded`);
  assert.ok(attempts[0].provider_message_id?.startsWith("synthetic-"), `${label} has a synthetic provider receipt`);
  const receipts = state.fixture_mail.filter((receipt) => receipt.key === row.idempotency_key);
  assert.equal(receipts.length, 1, `${label} has exactly one provider receipt`);
  assert.ok(mail.wireMail, `${label} retains its frozen provider message`);
  assert.equal(isDeepStrictEqual(JSON.parse(receipts[0].message_json), mail.wireMail), true, `${label} frozen message matches the provider receipt`);
}

try {
  if (process.argv[2] === "--before-restart") await verifyBeforeRestart();
  else if (process.argv[2] === "--after-restart") {
    const previous = JSON.parse(await readFile(evidencePath("mail-preferences-native.json"), "utf8"));
    await authenticate(previous.firstEmail); await authenticate(previous.secondEmail);
    assert.deepEqual(await preferences(previous.firstEmail), { bookingMailMuted: true }); assert.deepEqual(await preferences(previous.secondEmail), { bookingMailMuted: false });
    await setMuted(previous.firstEmail, false);
    const retry = await data(`/api/app/bookings/${previous.ambiguousBookingId}/deliveries/${previous.originalFailedId}/retry`, {}, 202, previous.firstEmail);
    assert.equal(retry.id, previous.retryId); assert.equal(retry.state, "succeeded");
    await deliver(); let state = await snapshot();
    assert.ok(previous.skippedKeys.every((key) => !sentKeys(state).has(key)), "unmuting does not resend completed skipped notices");
    assert.equal(state.fixture_mail.filter((row) => row.key === previous.originalProviderKey).length, 1);
    const event = await data("/api/public/events/dial-host/intro"), week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
    const slot = availability.slots.filter((entry) => Date.parse(entry.startAt) > Date.now() + 2 * 86400000)[16];
    const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
    await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Unmuted future invitee", email: "unmuted-future@dial.test", answers: { [event.eventType.questions[0].key]: "Synthetic future booking" } }, 201);
    await deliver(); state = await snapshot();
    const booking = state.bookings.find((row) => row.invitee_email === "unmuted-future@dial.test");
    const roleMail = state.delivery_outbox.filter((row) => row.booking_id === booking.id && row.kind === "mail_send" && ["operator", "invitee"].includes(payload(row).recipientRole));
    const confirmationSubjects = new Set([`Confirmed: ${event.eventType.title}`, `New booking: ${event.eventType.title}`]);
    const confirmation = roleMail.filter((row) => confirmationSubjects.has(payload(row).subject));
    assert.equal(confirmation.length, 3); assert.ok(confirmation.every((row) => sentKeys(state).has(row.idempotency_key) && providerId(state, row.id)?.startsWith("synthetic-")));
    const inviteeConfirmation = confirmation.filter((row) => payload(row).recipientRole === "invitee" && payload(row).subject === `Confirmed: ${event.eventType.title}`);
    const operatorConfirmations = confirmation.filter((row) => payload(row).recipientRole === "operator" && payload(row).subject === `New booking: ${event.eventType.title}`);
    assert.equal(inviteeConfirmation.length, 1);
    assert.equal(payload(inviteeConfirmation[0]).to, booking.invitee_email);
    assert.equal(operatorConfirmations.length, 2);
    assert.deepEqual(new Set(operatorConfirmations.map((row) => payload(row).to)), new Set([previous.firstEmail, previous.secondEmail]));
    assert.ok(payload(inviteeConfirmation[0]).text.includes("Google Meet link pending"), "the original confirmation keeps its pending Meet fact");
    assert.ok(payload(inviteeConfirmation[0]).text.includes("Calendar setup: pending."), "the original confirmation keeps its pending calendar state");

    const linkReady = state.delivery_outbox.filter((row) => row.booking_id === booking.id && row.kind === "mail_send" && row.idempotency_key.endsWith(":link-ready"));
    assert.equal(linkReady.length, 1);
    assert.equal(payload(linkReady[0]).recipientRole, "invitee");
    assert.deepEqual(roleMail.map((row) => row.id).sort(), [...confirmation, ...linkReady].map((row) => row.id).sort(), "all booking-wide role mail is exactly the three confirmations and the separate link-ready notice");
    assert.ok(roleMail.every((row) => row.occurrence_id === booking.current_occurrence_id), "every booking notice belongs to its current occurrence");
    assert.equal(payload(linkReady[0]).to, booking.invitee_email);
    assert.equal(payload(linkReady[0]).subject, "Your meeting link is ready");
    const meetingUrl = booking.meeting_url;
    assert.ok(typeof meetingUrl === "string" && meetingUrl.startsWith("https://meet.example.test/"), "the completed booking has its synthetic Meet link");
    const linkReadyMail = payload(linkReady[0]);
    for (const fact of [`Your meeting link is ready: ${meetingUrl}`, `Location: Google Meet: ${meetingUrl}`, "Calendar setup: succeeded.", `Join session: ${meetingUrl}`, "Manage this booking:", "Add to calendar:"]) {
      assert.ok(linkReadyMail.text.includes(fact), `link-ready message includes ${fact}`);
    }
    for (const row of [...confirmation, ...linkReady]) assertFrozenProviderReceipt(state, row, row === linkReady[0] ? "link-ready" : "booking confirmation");
    assert.ok(previous.skippedKeys.every((key) => !sentKeys(state).has(key)));
    const checks = [...previous.checks, "independent preferences survive process restart; unmuting enables future booking notices and never resends completed skipped notices or reopens completed retries"];
    console.log(`PASS ${checks.at(-1)}`);
    await writeFile(evidencePath("mail-preferences.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, proofs: previous.proofs, limits: ["Native Worker/D1 only; preference settings UI remains unverified under the explicit browser launch hold.", "Reminder commands were made due through task-only fixture controls while their current occurrences remained future. The ambiguous retry used a synthetic provider acceptance followed by a lost response."] }, null, 2) + "\n");
  } else throw new Error("Use --before-restart or --after-restart; no browser launch is provided.");
} catch (error) {
  await writeFile(evidencePath("mail-preferences-failure.json"), JSON.stringify({ observedAt: new Date().toISOString(), origin, phase: process.argv[2], failure: error.message, stack: error.stack }, null, 2) + "\n");
  throw error;
}
