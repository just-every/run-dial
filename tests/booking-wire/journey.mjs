import { recoveryJourney } from "./recovery-journey.mjs";
import { deletionJourney } from "./deletion-journey.mjs";
import { assertTimeRange, assertConfirmation, assertChange, assertLinkReady, assertReminder, timeRange, bookingMail, wireMail, recipient, textBody, htmlBody } from "./mail-contracts.mjs";
import { manageRotationJourney } from "./manage-rotation-journey.mjs";
import { assertReminderCadence } from "./reminder-cadence.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
const origin = process.env.DIAL_REVIEW_ORIGIN;
let cookie;
const checks = [];
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
  assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Wire owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
assert.deepEqual(await data("/api/app/calendar/setup"), { redirectUri: origin + "/api/calendar/oauth/callback", configured: true });
await call("/api/app/profile", { handle: "requests-host", name: "Request Host", title: "Advisor", biography: "Request a discussion.", timezone: "UTC", focusAreas: [], socialProof: [] }, 200, "PATCH");
const requestEvent = await data("/api/app/event-types", { slug: "request-only", title: "A conversation", description: "Suggest another time.", durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [] }, 201);
const publish = await call(`/api/app/event-types/${requestEvent.id}/publish`, {}, 409);
const publishError = (await publish.json()).error;
assert.equal(publishError.code, "event_not_ready");
assert.deepEqual(publishError.details.slice().sort(), ["google_meet_capability", "open_availability"]);
await data("/wire/health-failure", { enabled: true });
await call(`/api/app/event-types/${requestEvent.id}/open-requests`, {}, 409);
assert.equal((await data(`/api/app/event-types/${requestEvent.id}`)).status, "draft");
await data("/wire/health-failure", { enabled: false });
const opened = await data(`/api/app/event-types/${requestEvent.id}/open-requests`, {});
assert.equal(opened.requestOnly, true); assert.equal(opened.status, "published");
assert.equal((await data("/api/public/events/requests-host/request-only")).eventType.requestOnly, true);
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0,10);
assert.deepEqual((await data("/api/public/book/requests-host/request-only/availability")).slots, []);
await call("/api/public/book/requests-host/request-only/selection", { startAt: future + "T10:00:00.000Z", inviteeTimezone: "UTC" }, 503);
const composition = { inviteeName: "Request guest", inviteeEmail: "request@dial.test", inviteeTimezone: "UTC", note: "Please review", windows: [{ date: future, startMinute: 600, endMinute: 660 }] };
const review = await data("/api/public/events/requests-host/request-only/request/review", composition, 201);
await call(`/api/public/events/requests-host/request-only/request?nonce=${review.nonce}`, composition, 201);
await data("/__fixtures/deliver", {});
const requested = await state();
assert.equal(requested.calendar_connections.length, 0);
assert.equal(requested.bookings.length, 0); assert.equal(requested.booking_occurrences.length, 0); assert.equal(requested.booking_nonces.length, 0);
assert.equal(requested.availability_requests.length, 1); assert.equal(requested.availability_request_windows.length, 1);
assert.ok(requested.wire_calls.every(row => new URL(row.url).hostname === "api.sendgrid.com"));
assert.ok(requested.delivery_outbox.every(row => row.kind === "mail_send"));
const requestSends = wireMail(requested).filter(mail => ["We received your time request for A conversation", "New alternative time request from Request guest"].includes(mail.subject));
assert.equal(requestSends.length, 2, "invitee acknowledgement and operator request notice are sent");
for (const mail of requestSends) {
  assert.deepEqual(mail.content.map(part => part.type), ["text/plain", "text/html"]);
  const html = htmlBody(mail), body = textBody(mail);
  assert.ok(html.includes("Request Host")); assert.ok(html.includes("A conversation"));
  assert.ok(html.includes(future)); assert.ok(html.includes("10:00–11:00")); assert.ok(html.includes("UTC"));
  assert.ok(html.includes("Please review"));
  assert.ok(html.includes("Request Host"));
  assert.ok(body.includes("10:00–11:00")); assert.ok(body.includes("Please review")); assert.ok(body.includes("Host: Request Host"));
}
checks.push("request acknowledgement and operator copy carry matching text/plain and escaped branded text/html alternatives");
await call(`/api/app/availability-requests/${requested.availability_requests[0].id}/state`, { state: "handled" });
await data("/__fixtures/deliver", {});
const handledRequest = (await state()).wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").map(row => JSON.parse(row.body))
  .find(mail => mail.subject === "Your time request for A conversation is being handled");
assert.ok(handledRequest, "handled request sends its invitee update");
assert.deepEqual(handledRequest.content.map(part => part.type), ["text/plain", "text/html"]);
assert.ok(textBody(handledRequest).startsWith("The host is handling your request for A conversation and will follow up by email.\n\nHost: Request Host"));
assert.ok(htmlBody(handledRequest).includes("Request Host"));
checks.push("handled request update carries the existing acknowledgement text beside its branded HTML");
await call(`/api/app/event-types/${requestEvent.id}/publish`, {}, 409);
// Now establish the test-only calendar credentials and profile for the real adapter journey.
await data("/__fixtures/setup", {});
await call(`/api/app/event-types/${requestEvent.id}/availability`, { windows: [{ weekday: 1, startMinute: 600, endMinute: 660 }] }, 200, "PUT");
const bookingsOpened = await data(`/api/app/event-types/${requestEvent.id}/publish`, {});
assert.equal(bookingsOpened.requestOnly, false, "normal provider checks explicitly enable bookings");
const event = await data("/api/public/events/dial-host/intro");
// C.1 rotation journey uses a distinct identity and timezone through the public booking production path.
async function book(index, { name = `Wire guest ${index}`, email = `wire${index}@dial.test`, inviteeTimezone = "UTC" } = {}) {
  const available = await data(`/api/public/book/dial-host/intro/availability?week=${future}`);
  const startAt = available.slots[index].startAt;
  const selection = await data("/api/public/book/dial-host/intro/selection", { startAt, inviteeTimezone }, 201);
  const payload = { nonce: selection.nonce, startAt, inviteeTimezone, name, email, answers: { [event.eventType.questions[0].key]: "Wire lifecycle" } };
  const receipt = await data("/api/public/book/dial-host/intro/confirm", payload, 201);
  await call("/api/public/book/dial-host/intro/confirm", payload, 200);
  return { token: new URL(receipt.manageUrl).pathname.split("/").at(-1), receipt };
}
async function deliver() { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); }
await data("/wire/control", { name: "google-conference", value: "pending" });
const first = await book(0); await deliver();
let snap = await state();
const firstBookings = snap.bookings.filter(booking => booking.invitee_email === "wire0@dial.test");
assert.equal(firstBookings.length, 1, "the primary receipt has one persisted invitee booking");
const firstBooking = firstBookings[0];
assert.equal(firstBooking.meeting_state, "pending");
assert.equal(firstBooking.calendar_state, "succeeded");
assert.equal(firstBooking.meeting_url, null);
assert.equal((await data(`/api/public/manage/${first.token}`)).location.state, "pending");
assertConfirmation(snap, first.receipt, "wire0@dial.test");
assertLinkReady(snap, "wire0@dial.test", 0);
const reminderRecipients = [
  { to: "wire0@dial.test", recipientRole: "invitee" },
  { to: "operator@dial.test", recipientRole: "operator" },
];
const reminderRows = assertReminderCadence(snap, firstBooking.id, first.receipt.occurrence.startAt, reminderRecipients);
for (const reminder of reminderRows) {
  await call("/__fixtures/due", { id: reminder.id }, 204);
  await call("/__fixtures/deliver", { id: reminder.id });
}
snap = await state();
assertReminder(snap, "wire0@dial.test", first.receipt.host.name);
assertReminder(snap, "operator@dial.test", first.receipt.host.name);
checks.push("24-hour and 1-hour invitee/operator reminders reach SendGrid with matching plain and branded HTML facts and action links");
const pendingEvent = JSON.parse(snap.wire_events[0].payload);
const pendingPoll = snap.delivery_outbox.find(row => row.idempotency_key.includes("conference-poll"));
assert.ok(pendingPoll);
await data("/wire/event", { id: pendingEvent.id, payload: { ...pendingEvent, conferenceData: { createRequest: { ...pendingEvent.conferenceData.createRequest, status: { statusCode: "success" } }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/aaa-bbbb-ccc" }] } } });
await call("/__fixtures/due", { id: pendingPoll.id }, 204); await deliver();
snap = await state();
assertLinkReady(snap, "wire0@dial.test");
const completedCalls = snap.wire_calls.length;
await data("/__fixtures/deliver", { id: pendingPoll.id }); await data("/__fixtures/deliver", { id: pendingPoll.id });
assert.equal((await state()).wire_calls.length, completedCalls, "duplicate completion jobs repeat neither Google nor mail");
await data("/wire/control", { name: "google-conference", value: "success" });
checks.push("pending Meet confirmation wire recipients, both zones, answers, ICS and invitee-only manage capability; completion and duplicate job send exactly one link-ready email");
const booking = snap.bookings.find(row => row.id === firstBooking.id), eventId = booking.calendar_provider_event_id;
assert.ok(eventId); assert.equal(booking.meeting_state, "succeeded"); assert.equal(booking.meeting_url, "https://meet.google.com/aaa-bbbb-ccc");
const insert = snap.wire_calls.find(row => row.method === "POST" && new URL(row.url).pathname.endsWith("/events"));
assert.equal(new URL(insert.url).searchParams.get("conferenceDataVersion"), "1");
assert.equal(JSON.parse(insert.body).conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
const insertedEvent = JSON.parse(insert.body);
assert.equal(insertedEvent.summary, "A focused introduction");
assert.deepEqual(insertedEvent.attendees, [{ email: "wire0@dial.test" }]);
assert.deepEqual(insertedEvent.start, { dateTime: first.receipt.occurrence.startAt, timeZone: "Australia/Brisbane" });
assert.deepEqual(insertedEvent.end, { dateTime: first.receipt.occurrence.endAt, timeZone: "Australia/Brisbane" });
assert.equal(insertedEvent.extendedProperties.private["dial-booking-id"], booking.id);
assert.equal(insertedEvent.extendedProperties.private["dial-occurrence-id"], booking.current_occurrence_id);
assert.equal(insertedEvent.extendedProperties.private["dial-ical-uid"], booking.ical_uid);
assert.ok(insertedEvent.extendedProperties.private["dial-idempotency-key"].includes(booking.current_occurrence_id));
assert.equal(insertedEvent.conferenceData.createRequest.requestId, insertedEvent.extendedProperties.private["dial-idempotency-key"]);
const available = await data(`/api/public/manage/${first.token}/reschedule/availability?week=${future}`);
// C.1 regression: the previous time stays in UTC while the selected new time uses New York.
const startAt = available.slots[4].startAt, inviteeTimezone = "America/New_York";
const selected = await data(`/api/public/manage/${first.token}/reschedule/selection`, { startAt, inviteeTimezone }, 201);
const changed = await data(`/api/public/manage/${first.token}/reschedule`, { nonce: selected.nonce, startAt, inviteeTimezone, reason: "Wire reschedule" });
assertReminderCadence(await state(), booking.id, changed.occurrence.startAt, reminderRecipients);
checks.push("public confirmation and reschedule persist exactly one 24-hour and one 1-hour reminder per invitee/operator for the current occurrence, with no stale scheduled reminders");
await deliver();
assertChange(await state(), first.receipt, changed, "wire0@dial.test", "reschedule", "Wire reschedule", "the invitee", booking.id);
snap = await state();
assert.equal(snap.bookings.find(row => row.id === booking.id).calendar_provider_event_id, eventId);
const patch = snap.wire_calls.findLast(row => row.method === "PATCH" && JSON.parse(row.body).start);
assert.equal(new URL(patch.url).pathname.split("/").at(-1), eventId); assert.equal(new URL(patch.url).searchParams.get("conferenceDataVersion"), "1");
assert.equal(JSON.parse(patch.body).start.dateTime, startAt);
await manageRotationJourney({ data, call, state, book, future, checks });
const intro = (await data("/api/app/event-types")).find(item => item.slug === "intro");
await call(`/api/app/event-types/${intro.id}/disable`, {});
await call(`/api/app/event-types/${intro.id}/open-requests`, {});
assert.equal((await data(`/api/public/manage/${first.token}`)).state, "rescheduled", "existing booking survives request-only transition");
await call(`/api/public/manage/${first.token}/cancel`, { reason: "Wire cancellation" }); await deliver();
snap = await state();
assert.equal(snap.bookings.find(row => row.id === booking.id).state, "cancelled");
assertChange(snap, first.receipt, changed, "wire0@dial.test", "cancel", "Wire cancellation", "the invitee", booking.id);
await call(`/api/public/manage/${first.token}/cancel`, { reason: "Wire cancellation" });
assert.equal(JSON.parse(snap.wire_events.find(row => row.id === eventId).payload).status, "cancelled");
const sends = snap.wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").map(row => JSON.parse(row.body));
for (const expression of [/confirmed/i, /rescheduled/i, /cancelled/i]) assert.ok(sends.some(mail => expression.test(mail.subject)), String(expression));
assert.ok(snap.base_mail_dispatch.some(row => row.state === "accepted" && row.provider_message_id === null));
for (const mail of snap.delivery_outbox.filter(row => row.booking_id && row.kind === "mail_send" && row.state === "succeeded")) {
  await call(`/api/app/bookings/${mail.booking_id}/deliveries/${mail.id}/retry`, {}, 409);
}
const acceptedMail = snap.delivery_outbox.find(row => row.booking_id === booking.id && row.kind === "mail_send" && row.state === "succeeded" && JSON.parse(row.payload_json).to === "wire0@dial.test" && JSON.parse(row.payload_json).bookingState === "cancelled");
assert.ok(acceptedMail);
await call("/__fixtures/due", { id: acceptedMail.id, processing: true }, 204);
const sendsBefore = sends.length; await deliver();
assert.equal((await state()).wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").length, sendsBefore);
assert.equal((await data(`/api/app/event-types/${intro.id}/publish`, {})).requestOnly, false);
const second = await book(8); await deliver(); snap = await state();
const secondBookings = snap.bookings.filter(row => row.invitee_email === "wire8@dial.test");
assert.equal(secondBookings.length, 1, "the second receipt has one persisted invitee booking");
const secondBooking = secondBookings[0];
assert.equal(secondBooking.state, "confirmed");
assert.ok(secondBooking.calendar_provider_event_id);
const readsBefore = snap.wire_calls.length;
await data("/wire/delete", { id: secondBooking.calendar_provider_event_id });
snap = await state();
assert.equal((await data(`/api/public/manage/${second.token}`)).state, "cancelled");
assert.ok(snap.wire_calls.slice(readsBefore).some(row => row.method === "GET" && new URL(row.url).pathname.endsWith(`/events/${secondBooking.calendar_provider_event_id}`)));
assert.ok(snap.wire_calls.slice(readsBefore).some(row => row.method === "GET" && new URL(row.url).searchParams.get("showDeleted") === "false"));
assert.equal(snap.calendar_deletion_probes.at(-1).state, "resolved");
await deliver(); snap = await state();
const externalCancellation = bookingMail(snap, secondBooking.id).filter(mail => /^Booking cancelled:/.test(mail.subject));
assert.equal(externalCancellation.length, 2);
assert.deepEqual(externalCancellation.flatMap(recipient).sort(), ["operator@dial.test", "wire8@dial.test"]);
for (const mail of externalCancellation) {
  assert.equal(mail.subject, `Booking cancelled: ${second.receipt.event.eventTitle}`);
  assert.match(textBody(mail), /by the connected calendar/);
  assertTimeRange(textBody(mail), htmlBody(mail), timeRange(second.receipt.occurrence.startAt, second.receipt.occurrence.endAt, "UTC"), "Previous invitee time: ");
  assertTimeRange(textBody(mail), htmlBody(mail), timeRange(second.receipt.occurrence.startAt, second.receipt.occurrence.endAt, "Australia/Brisbane"), "Previous host time: ");
  assert.ok(textBody(mail).includes("Reason: deleted_in_google_calendar."));
  assert.ok(textBody(mail).includes("Calendar state: Update pending."));
  assert.ok(htmlBody(mail).includes("Reason: deleted_in_google_calendar."));
  assert.ok(htmlBody(mail).includes("Calendar state"));
  assert.ok(htmlBody(mail).includes("Booking cancelled"));
  // C.1 gives each preserved zone its own labeled time range for text/HTML parity.
  assert.match(textBody(mail), /Previous invitee time: .+\(UTC\)/);
  assert.match(textBody(mail), /Previous host time: .+\(Australia\/Brisbane\)/);
}
const deletionMailCount = wireMail(snap).length;
await data("/wire/delete", { id: secondBooking.calendar_provider_event_id }); await deliver();
assert.equal(wireMail(await state()).length, deletionMailCount, "repeated Google tombstone sends no second cancellation");
checks.push("authoritative Google deletion sends exact invitee/operator cancellation wire once with provider actor, previous time, zones and reason");
await recoveryJourney({ data, call, state, book, deliver, future, checks });
await deletionJourney({ data, state, book, deliver, checks });
await data("/wire/ambiguous", {});
await book(12); await deliver(); snap = await state();
assert.ok(snap.base_mail_dispatch.some(row => row.state === "uncertain"));
for (const mail of snap.delivery_outbox.filter(row => row.last_error_code === "mail_outcome_unknown")) {
  await call(`/api/app/bookings/${mail.booking_id}/deliveries/${mail.id}/retry`, {}, 409);
}
const ambiguousSends = snap.wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").length;
await deliver();
assert.equal((await state()).wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").length, ambiguousSends, "ambiguous SendGrid outcome never automatically repeats");
await writeFile(evidencePath("booking-wire.json"), JSON.stringify({ checks: [...checks, "never-connected request-only admission without booking/calendar side effects", "normal publish gate preserved", "Google Meet conferenceDataVersion=1", "reschedule same event", "cancel event", "fresh authoritative GET/list after external deletion", "Base SendGrid confirmation/reschedule/cancel with nullable receipt", "exact replay, interrupted accepted delivery recovery and ambiguous mail no-repeat"], scope: "Native local D1 and production services/adapters with contract-shaped provider wire fixtures" }, null, 2));
console.log("Production Google + Base SendGrid lifecycle and native request-only journey passed.");
