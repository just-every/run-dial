import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { bookingMail, recipient, textBody } from "./mail-contracts.mjs";

const origin = process.env.DIAL_REVIEW_ORIGIN;
const provider = process.argv[2];
assert.ok(["google", "microsoft"].includes(provider));
let cookie;
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, {
    method, redirect: "manual",
    headers: { origin, "content-type": ["application", "json"].join("/"), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${method} ${path.replace(/\/manage\/[^/?]+/gu, "/manage/[redacted]")}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const profile = name => call("/api/app/profile", {
  handle: "calendar-template-host", name, title: "Advisor", biography: "Plan a synthetic appointment.",
  timezone: "UTC", focusAreas: [], socialProof: [],
}, 200, "PATCH");

const boot = await call("/auth/bootstrap", {
  token: "dial-test-only-setup-token-at-least-32", displayName: "Synthetic Dial Owner", returnTo: "/app",
}, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await profile("Morgan Bell");
if (provider === "microsoft") await data("/wire/control", { name: "microsoft-primary", value: "synthetic-dial-901" });
const authorization = new URL((await call("/api/app/calendar/oauth/start", undefined, 302)).headers.get("location"));
assert.equal(authorization.hostname, provider === "google" ? "accounts.google.com" : "login.microsoftonline.com");
await call(`/api/calendar/oauth/callback?${new URLSearchParams({
  state: authorization.searchParams.get("state"),
  code: provider === "google" ? "wire-consent" : "synthetic-dial-810-work-correspondence",
})}`, undefined, 302);
const destination = provider === "google" ? "synthetic-calendar" : "synthetic-dial-901";
await data("/api/app/calendar/selection", { destinationCalendarId: destination, conflictCalendarIds: [destination] }, 200, "PUT");
assert.equal((await data("/api/app/calendar/check", {})).kind, "healthy");
await data("/api/app/mail/check", {});

const event = await data("/api/app/event-types", {
  slug: "calendar-correspondence", title: "Studio planning", description: "Discuss a synthetic commission.",
  durationMinutes: 30, color: "#176b5a", locationType: "in_person", locationLabel: "Studio", locationValue: "Room 4",
  listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0,
  bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null,
  questions: [
    { kind: "text", label: "Project goals", required: true, private: false, options: [] },
    { kind: "text", label: "Private budget", required: true, private: true, options: [] },
  ],
  hours: { uses: "own", windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 840 })) },
}, 201);
const [goal, budget] = event.questions;
const correspondencePath = `/api/app/event-types/${event.id}/correspondence`;
const config = await data(correspondencePath);
assert.equal(config.invitationManageLinkEnabled, true);
config.templates.calendarTitle = "{invitee full name} & {host name}";
config.templates.calendarDescription = `Project: {event name}\nWhen: {date and time}\nWhere: {location}\nGoals: {answer.${goal.key}}`;
config.templates.confirmationSubject = "Your saved studio confirmation";
config.templates.confirmationBody = "Hello {invitee first name}. This is the saved confirmation.\n{date and time}";
await data(correspondencePath, config, 200, "PUT");
assert.deepEqual(await data(correspondencePath), config, "the native editor persists the complete saved configuration");
await data(`/api/app/event-types/${event.id}/publish`, {});

// Compare transport output with the selected UTC instants without using the product renderer.
function expectedTime(iso) {
  const date = new Date(iso), hour = date.getUTCHours();
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hour % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"} UTC+00:00`;
}
const baseDescription = slot => `Project: Studio planning\nWhen: ${expectedTime(slot.startAt)}–${expectedTime(slot.endAt)} (UTC)\nWhere: Studio: Room 4\nGoals: A library sculpture`;
function calendarWrites(snapshot, bookingId) {
  return snapshot.wire_calls.filter(row => {
    if (!["POST", "PATCH"].includes(row.method)) return false;
    const url = new URL(row.url);
    if (url.hostname !== (provider === "google" ? "www.googleapis.com" : "graph.microsoft.com") || !/\/events(?:\/[^/]+)?$/u.test(url.pathname)) return false;
    const body = JSON.parse(row.body);
    return provider === "google" ? body.extendedProperties?.private?.["dial-booking-id"] === bookingId
      : body.singleValueExtendedProperties?.some(property => property.id.endsWith(" Name DialBookingId") && property.value === bookingId);
  });
}
function assertCalendar(write, slot, hostName, linkEnabled, manageToken, invitationUrl) {
  assert.ok(write, "the ordinary booking delivery writes the managed provider event");
  const body = JSON.parse(write.body);
  assert.equal(provider === "google" ? body.summary : body.subject, `Avery Chen & ${hostName}`);
  if (provider === "microsoft") assert.equal(body.body.contentType, "text");
  const description = provider === "google" ? body.description : body.body.content;
  let invitation;
  if (linkEnabled) {
    invitation = /Manage this booking: (\S+)/u.exec(description)?.[1];
    assert.ok(invitation, "the enabled description carries its invitation capability");
    const url = new URL(invitation);
    assert.equal(url.origin, origin);
    assert.match(url.pathname, /^\/manage\/invite\/[^/]+$/u);
    if (invitationUrl) assert.equal(invitation, invitationUrl, "rescheduling retains the invitation identity");
  }
  assert.equal(description, baseDescription(slot) + (linkEnabled ? `\n\nManage this booking: ${invitation}\nThis link emails a booking management link to the invitee.` : ""));
  assert.deepEqual(body.start, { dateTime: provider === "google" ? slot.startAt : slot.startAt.slice(0, 19), timeZone: "UTC" });
  assert.deepEqual(body.end, { dateTime: provider === "google" ? slot.endAt : slot.endAt.slice(0, 19), timeZone: "UTC" });
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("synthetic-dial-private-902"), false, "private answers never enter the shared calendar request");
  assert.equal(serialized.includes(budget.key), false, "private answer identifiers never enter the shared calendar request");
  assert.equal(serialized.includes(manageToken), false, "the booking manage capability never enters either provider request");
  if (!linkEnabled) assert.equal(description.includes("/manage/"), false, "the disabled description contains no invitation link");
  return invitation;
}
function assertMail(snapshot, bookingId, email, moves) {
  const inviteeMail = bookingMail(snapshot, bookingId).filter(mail => recipient(mail).includes(email));
  const confirmations = inviteeMail.filter(mail => mail.subject === "Your saved studio confirmation");
  assert.equal(confirmations.length, 1, "the edited confirmation replaces the built-in confirmation exactly once");
  assert.ok(textBody(confirmations[0]).startsWith("Hello Avery. This is the saved confirmation.\n"));
  assert.equal(inviteeMail.length, 1 + moves, "each reschedule adds exactly one ordinary invitee change notice");
}
async function assertRedeliveryIsInert(snapshot, bookingId) {
  for (const row of snapshot.delivery_outbox.filter(row => row.booking_id === bookingId && row.state === "succeeded" && ["calendar_upsert", "mail_send"].includes(row.kind))) {
    await data("/__fixtures/deliver", { id: row.id });
  }
  await deliver();
  const repeated = await state();
  assert.deepEqual(calendarWrites(repeated, bookingId), calendarWrites(snapshot, bookingId), "replayed deliveries add no provider mutation");
  assert.deepEqual(bookingMail(repeated, bookingId), bookingMail(snapshot, bookingId), "replayed deliveries add no confirmation or change mail");
  assert.deepEqual(repeated.wire_events, snapshot.wire_events, "replayed deliveries add or change no provider event");
}

const base = "/api/public/book/calendar-template-host/calendar-correspondence";
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const checks = [];
for (const enabledAtCreation of [true, false]) {
  config.invitationManageLinkEnabled = enabledAtCreation;
  await data(correspondencePath, config, 200, "PUT");
  await profile("Morgan Bell");
  const slot = (await data(`${base}/availability?week=${future}`)).slots[0]; assert.ok(slot);
  const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: "America/Los_Angeles" }, 201);
  const email = [`synthetic-dial-${enabledAtCreation ? 903 : 904}`, "example.test"].join("@");
  const input = {
    nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "America/Los_Angeles", name: "Avery Chen", email,
    answers: { [goal.key]: "A library sculpture", [budget.key]: "synthetic-dial-private-902" },
  };
  const receipt = await data(`${base}/confirm`, input, 201);
  await call(`${base}/confirm`, input, 200);
  const bookingId = receipt.bookingReference;
  const manageToken = new URL(receipt.manageUrl).pathname.split("/").at(-1);
  const manage = `/api/public/manage/${manageToken}`;
  await deliver();
  let snapshot = await state(), writes = calendarWrites(snapshot, bookingId);
  assert.equal(writes.length, 1); assert.equal(writes[0].method, "POST");
  const invitationUrl = assertCalendar(writes[0], slot, "Morgan Bell", enabledAtCreation, manageToken);
  const initial = snapshot.bookings.find(row => row.id === bookingId);
  assert.equal(initial.calendar_state, "succeeded");
  assert.ok(initial.calendar_provider_event_id);
  const providerEvent = snapshot.wire_events.find(row => row.id === initial.calendar_provider_event_id); assert.ok(providerEvent);
  const calendarUid = payload => provider === "google" ? payload.extendedProperties.private["dial-ical-uid"] : payload.iCalUId;
  const providerUid = calendarUid(JSON.parse(providerEvent.payload));
  assert.ok(providerUid);
  assertMail(snapshot, bookingId, email, 0);
  await assertRedeliveryIsInert(snapshot, bookingId);

  // Updating the real profile makes a stale title observable, as well as a stale time range.
  await profile("Morgan Reed");
  let previousSlot = slot;
  for (const [index, enabled] of (enabledAtCreation ? [true, false] : [false]).entries()) {
    config.invitationManageLinkEnabled = enabled;
    await data(correspondencePath, config, 200, "PUT");
    const next = (await data(`${manage}/reschedule/availability?week=${future}`)).slots.find(candidate => candidate.startAt > previousSlot.startAt);
    assert.ok(next);
    const selected = await data(`${manage}/reschedule/selection`, { startAt: next.startAt, inviteeTimezone: "America/Los_Angeles" }, 201);
    await data(`${manage}/reschedule`, { nonce: selected.nonce, startAt: next.startAt, inviteeTimezone: "America/Los_Angeles", reason: "A new studio time" });
    await deliver();
    snapshot = await state(); writes = calendarWrites(snapshot, bookingId);
    assert.equal(writes.length, index + 2); assert.equal(writes.at(-1).method, "PATCH");
    assert.equal(decodeURIComponent(new URL(writes.at(-1).url).pathname.split("/").at(-1)), initial.calendar_provider_event_id);
    assertCalendar(writes.at(-1), next, "Morgan Reed", enabled, manageToken, invitationUrl);
    const moved = snapshot.bookings.find(row => row.id === bookingId);
    assert.equal(moved.calendar_state, "succeeded");
    assert.equal(moved.calendar_provider_event_id, initial.calendar_provider_event_id);
    assert.equal(moved.ical_uid, initial.ical_uid);
    assert.equal(calendarUid(JSON.parse(snapshot.wire_events.find(row => row.id === initial.calendar_provider_event_id).payload)), providerUid);
    assertMail(snapshot, bookingId, email, index + 1);
    await assertRedeliveryIsInert(snapshot, bookingId);
    previousSlot = next;
  }
  assert.equal(calendarWrites(snapshot, bookingId).filter(row => row.method === "POST").length, 1);
  checks.push(`${provider}: saved title and exact UTC description on creation and reschedule, invitation link ${enabledAtCreation ? "enabled then disabled" : "disabled throughout"}, stable event identity, private answer and manage capability exclusion, once-only mail and event delivery`);
}
await writeFile(evidencePath(`calendar-correspondence-${provider}.json`), JSON.stringify({ checks, scope: "Native operator and public booking routes; both provider and mail transports synthetic at the HTTP edge" }, null, 2));
console.log(`${provider} calendar correspondence public-door journey passed.`);
