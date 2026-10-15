import assert from "node:assert/strict";
import { contractTitle } from "../contract.mjs";
import { assertTimeRange, assertActionParity, htmlBody, recipient, textBody, timeRange, wireMail } from "./mail-contracts.mjs";

export async function occurrenceDurationJourney(origin, t) {
  let cookie;
  async function data(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
    assert.equal(response.status, expected, `production request status (${method}; capability omitted)`);
    return expected === 204 || expected === 303 ? response : response.json();
  }
  const state = () => data("/wire/state");
  const boot = await data("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Duration owner", returnTo: "/app" }, 303);
  cookie = boot.headers.get("set-cookie").split(";")[0];
  await data("/__fixtures/setup", {});
  const event = (await data("/api/app/event-types")).find(item => item.slug === "intro");
  const keys = ["slug", "title", "description", "durationMinutes", "color", "locationType", "locationLabel", "locationValue", "listed", "slotIncrementMinutes", "minimumNoticeMinutes", "bookingHorizonDays", "beforeBufferMinutes", "afterBufferMinutes", "hostDayBookingLimit", "questions"];
  const details = Object.fromEntries(keys.map(key => [key, event[key]]));
  const title = "Duration <review> & audit";
  await data(`/api/app/event-types/${event.id}/details`, { ...details, title }, 200, "PATCH");
  const week = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const availability = () => data(`/api/public/book/dial-host/intro/availability?week=${week}`);
  const startAt = (await availability()).slots[0].startAt;
  const selection = await data("/api/public/book/dial-host/intro/selection", { startAt, inviteeTimezone: "UTC" }, 201);
  const email = "occurrence-duration@dial.test";
  const first = await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", name: "Duration <guest>", email, answers: { [event.questions[0].key]: "Changed duration" } }, 201);
  let snapshot = await state();
  const booking = snapshot.bookings.find(item => item.invitee_email === email);
  const deliver = async row => { assert.ok(row, "the production transaction queued its delivery"); await data("/__fixtures/deliver", { id: row.id }); };
  const currentRows = kind => snapshot.delivery_outbox.filter(row => row.booking_id === booking.id && row.occurrence_id === snapshot.bookings.find(item => item.id === booking.id).current_occurrence_id && row.kind === kind);
  await t.test(contractTitle("NOTIFY-001", "original confirmation retains its exact 30-minute occurrence and escaped text/HTML facts"), async () => {
    for (const row of currentRows("mail_send")) await deliver(row);
    snapshot = await state();
    const confirmations = wireMail(snapshot).filter(mail => ["Confirmed: " + title, "New booking: " + title].includes(mail.subject));
    assert.equal(confirmations.length, 2);
    for (const mail of confirmations) assertFacts(mail, 30, "Calendar setup: Update pending.", title);
  });
  // Complete the original calendar first, so the reschedule must replace a succeeded state with pending.
  for (const row of currentRows("calendar_upsert")) await deliver(row);
  snapshot = await state();
  assert.equal(snapshot.bookings.find(item => item.id === booking.id).calendar_state, "succeeded");
  // Change the actual event through its operator route. The booking's creation snapshot stays 30.
  await data(`/api/app/event-types/${event.id}/details`, { ...details, title, durationMinutes: 60 }, 200, "PATCH");
  const next = (await availability()).slots.find(slot => slot.startAt !== startAt);
  assert.ok(next);
  const reason = "New duration <confirmed> & pending calendar";
  const changed = await data(`/api/app/bookings/${booking.id}/reschedule`, { startAt: next.startAt, inviteeTimezone: "America/New_York", reason, overridePublishedAvailability: false });
  snapshot = await state();
  assert.equal(snapshot.bookings.find(item => item.id === booking.id).duration_minutes, 30, "the creation snapshot is deliberately unchanged");
  assert.equal(duration(changed.occurrence), 60);
  assert.equal(changed.durationMinutes, 60);
  assert.equal(changed.calendarState, "pending");
  await t.test(contractTitle("NOTIFY-004", "changed-duration reschedule preserves prior 30-minute time and describes the new 60-minute pending occurrence"), async () => {
    for (const row of currentRows("mail_send")) await deliver(row);
    snapshot = await state();
    const mails = wireMail(snapshot).filter(mail => mail.subject === "Rescheduled: " + title);
    assert.equal(mails.length, 2);
    for (const mail of mails) {
      assertFacts(mail, 60, "Calendar state: Update pending.", title);
      for (const [label, occurrence, zone] of [["Previous invitee", first.occurrence, "UTC"], ["New invitee", changed.occurrence, "America/New_York"], ["Previous host", first.occurrence, "Australia/Brisbane"], ["New host", changed.occurrence, "Australia/Brisbane"]]) {
        const range = timeRange(occurrence.startAt, occurrence.endAt, zone);
        assertTimeRange(textBody(mail), htmlBody(mail), range, `${label} time: `);
      }
      assert.ok(textBody(mail).includes(`Reason: ${reason}`));
      assert.ok(htmlBody(mail).includes(escape(reason)));
    }
  });
  await t.test(contractTitle("NOTIFY-002", "link-ready mail selects the current 60-minute occurrence despite the 30-minute booking snapshot"), async () => {
    for (const row of currentRows("calendar_upsert")) await deliver(row);
    snapshot = await state();
    const link = currentRows("mail_send").find(row => JSON.parse(row.payload_json).subject === "Your meeting link is ready");
    await deliver(link);
    snapshot = await state();
    const mails = wireMail(snapshot).filter(mail => mail.subject === "Your meeting link is ready" && recipient(mail).includes(email));
    assert.equal(mails.length, 1);
    assertFacts(mails[0], 60, "Calendar setup: Up to date.", title);
  });
  await t.test(contractTitle("NOTIFY-003", "all recipient reminders select the current 60-minute occurrence"), async () => {
    const rows = currentRows("reminder");
    assert.equal(rows.length, 4);
    for (const row of rows) { await data("/__fixtures/due", { id: row.id }, 204); await deliver(row); }
    snapshot = await state();
    const mails = wireMail(snapshot).filter(mail => mail.subject === "Reminder: " + title);
    assert.equal(mails.length, 4);
    for (const mail of mails) assertFacts(mail, 60, "Calendar setup: Up to date.", title);
  });
  await t.test(contractTitle("NOTIFY-004", "Google cancellation describes the transaction-selected current 60-minute occurrence in both parts"), async () => {
    const persisted = snapshot.bookings.find(item => item.id === booking.id);
    await data("/wire/delete", { id: persisted.calendar_provider_event_id });
    snapshot = await state();
    assert.equal(snapshot.bookings.find(item => item.id === booking.id).state, "cancelled");
    for (const row of currentRows("mail_send").filter(row => JSON.parse(row.payload_json).subject === "Booking cancelled: " + title)) await deliver(row);
    snapshot = await state();
    const mails = wireMail(snapshot).filter(mail => mail.subject === "Booking cancelled: " + title);
    assert.equal(mails.length, 2);
    for (const mail of mails) {
      assertFacts(mail, 60, "Calendar state: Update pending.", title);
      assert.match(textBody(mail), /^Reason: deleted_in_google_calendar\.$/mu);
      assert.ok(htmlBody(mail).includes("Reason: deleted_in_google_calendar."));
      assert.ok(textBody(mail).includes(`Previous invitee time: ${timeRange(changed.occurrence.startAt, changed.occurrence.endAt, "America/New_York")}`));
      assert.equal(textBody(mail).includes("Duration: 30 minutes"), false);
      assert.equal(htmlBody(mail).includes("30 minutes"), false);
    }
  });
  return { scope: "Actual migrated native D1, operator/public routes, Google reconciliation, Base SendGrid wire", originalDurationMinutes: 30, currentDurationMinutes: 60, checks: 5 };
}

function assertFacts(mail, minutes, calendarLine, title) {
  assert.deepEqual(mail.content.map(part => part.type), ["text/plain", "text/html"]);
  const text = textBody(mail), html = htmlBody(mail);
  assert.ok(text.includes(`Duration: ${minutes} minutes`));
  const facts = new Map([...html.matchAll(/<tr><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><\/tr>/gu)].map(match => [match[1], match[2]]));
  assert.equal(facts.get("Duration"), `${minutes} minutes`);
  assert.ok(text.includes(calendarLine));
  const [calendarLabel, calendarValue] = calendarLine.replace(/\.$/u, "").split(": ");
  assert.equal(facts.get(calendarLabel), calendarValue);
  assert.ok(text.includes(title));
  assert.ok(html.includes(escape(title)));
  assert.equal(html.includes(title), false);
  assert.match(html, /<table\b/u);
  assert.match(html, /style="/u);
  assertActionParity(text, html);
}
function duration(occurrence) { return (Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt)) / 60000; }
function escape(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
