import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { authenticate, call, data, origin, productRecords, snapshot } from "../tests/availability-diagnostics/helpers.mjs";

const evidencePath = outputPath("host-authoring-native.json"), checks = [];
const mark = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const fields = ["slug", "title", "description", "durationMinutes", "color", "locationType", "locationLabel", "locationValue", "listed", "slotIncrementMinutes", "minimumNoticeMinutes", "bookingHorizonDays", "beforeBufferMinutes", "afterBufferMinutes", "hostDayBookingLimit", "questions"];
const details = (event, changes = {}) => ({ ...Object.fromEntries(fields.map((key) => [key, event[key]])), ...changes });
const full = (event, changes = {}) => ({ ...details(event), alternativeRequestsEnabled: event.alternativeRequestsEnabled, availability: event.availability, ...changes });
const without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
const normalizeWindows = (windows) => [...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
const protectedTables = ["bookings", "booking_occurrences", "booking_history", "booking_answers", "booking_manage_tokens", "booking_nonces", "delivery_outbox", "delivery_attempts", "availability_date_overrides", "availability_date_override_windows"];
const protectedRows = (state) => Object.fromEntries(protectedTables.map((table) => [table, state[table]]));
const futureDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const probe = (kind, failure) => call("/__fixtures/control", { kind, failure }, 204);
async function unchanged(action) {
  const before = await snapshot(), result = await action();
  assert.deepEqual(productRecords(await snapshot()), productRecords(before)); return result;
}
async function readiness(id, missing) {
  const result = await unchanged(() => data(`/api/app/event-types/${id}/readiness`, undefined, 200, true));
  assert.equal(result.ready, missing.length === 0); assert.deepEqual([...result.missing].sort(), [...missing].sort());
}
async function pausePublish(event, mutation, expected = 409, expectedStatus) {
  await call("/__fixtures/authoring/barrier", { armed: true }, 204);
  const pending = call(`/api/app/event-types/${event.id}/publish`, {}, expected, true);
  try {
    let entered = false;
    for (let i = 0; i < 120; i++) {
      if ((await data("/__fixtures/authoring/barrier")).entered === 1) { entered = true; break; }
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.ok(entered, "native publish must enter task-owned provider probe barrier");
    await mutation();
  } finally { await call("/__fixtures/authoring/barrier", { armed: false }, 204); }
  const result = await (await pending).json();
  assert.equal(result.error.code, expected === 404 ? "event_not_found" : "event_not_ready");
  if (expected === 409) {
    assert.ok(result.error.details.includes("event_configuration_changed"));
    assert.equal((await data(`/api/app/event-types/${event.id}`, undefined, 200, true)).status, expectedStatus ?? "draft");
  }
  return result;
}

try {
  const fixture = await data("/__fixtures/setup", {}); await authenticate(fixture.operatorEmail);
  const base = `/api/app/event-types/${fixture.eventId}`;
  let event = await data(base, undefined, 200, true);
  const originalQuestion = event.questions[0];
  event = await data(`${base}/details`, details(event, { locationType: "in_person", locationLabel: "Private office", locationValue: "Confidential room 42", title: "Original booked title" }), 200, true, "PATCH");
  const booking = await data("/api/app/bookings", { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: `${futureDate}T10:00:00.000Z`, inviteeTimezone: "UTC", name: "Synthetic authoring invitee", email: "authoring@dial.test", answers: { [originalQuestion.key]: "Original booked answer" }, overrideNoticeAndHorizon: false }, 201, true);
  await data(`${base}/availability-overrides/${futureDate}`, { mode: "closed", windows: [] }, 200, true, "PUT");
  const beforeWindows = await snapshot(), initialDetails = without(event, ["availability", "updatedAt"]);
  const windowsA = [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 2, startMinute: 1380, endMinute: 1440 }];
  event = await data(`${base}/availability`, { windows: windowsA }, 200, true, "PUT");
  assert.deepEqual(without(event, ["availability", "updatedAt"]), initialDetails);
  assert.deepEqual(normalizeWindows(event.availability), windowsA);
  assert.deepEqual(protectedRows(await snapshot()), protectedRows(beforeWindows));
  mark("native availability-only replacement accepts midnight end1440 and preserves metadata, questions, published status, alternative flag, date overrides and committed booking snapshots");

  await unchanged(async () => {
    await call(`${base}/availability`, { windows: [] }, 401, false, "PUT");
    await call(`${base}/details`, details(event), 401, false, "PATCH");
    await call(`${base}/readiness`, undefined, 401);
    await call(`${base}/availability`, { windows: [] }, 403, true, "PUT", { origin: "https://forged.example.test" });
    await call(`${base}/details`, details(event), 403, true, "PATCH", { origin: "https://forged.example.test" });
    for (const [suffix, body, method] of [["availability", { windows: windowsA }, "PUT"], ["details", details(event), "PATCH"], ["readiness", undefined, "GET"]]) await call(`/api/app/event-types/${"A".repeat(26)}/${suffix}`, body, 404, true, method);
    for (const windows of [[{ weekday: 1, startMinute: 500, endMinute: 600 }, { weekday: 1, startMinute: 550, endMinute: 700 }], [{ weekday: 1, startMinute: 1440, endMinute: 1440 }], [{ weekday: 1, startMinute: 540, endMinute: 1441 }]]) await call(`${base}/availability`, { windows }, 400, true, "PUT");
    await call(`${base}/availability`, { windows: [], title: "forged detail" }, 400, true, "PUT");
    const badQuestions = [
      [{ ...originalQuestion, key: "bad" }],
      [{ ...originalQuestion, kind: "single_choice", options: [] }],
      [{ ...originalQuestion, options: [{ value: "a", label: "A" }] }],
      [{ ...originalQuestion, kind: "single_choice", options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }],
      [originalQuestion, originalQuestion],
    ];
    for (const questions of badQuestions) await call(`${base}/details`, details(event, { questions }), 400, true, "PATCH");
    for (const changes of [{ title: "" }, { durationMinutes: 0 }, { color: "red" }, { locationValue: " " }, { availability: [] }, { alternativeRequestsEnabled: false }]) await call(`${base}/details`, details(event, changes), 400, true, "PATCH");
  });
  mark("session, origin, missing-resource and strict window/question/metadata refusals are native and leave all product data unchanged");

  const beforeDetails = await snapshot(), beforeAvailability = event.availability;
  const update = details(event, { title: "New future title", description: "New future description", durationMinutes: 60, locationType: "phone", locationLabel: "Private phone", locationValue: "+61 synthetic private number", questions: [{ ...originalQuestion, label: "Updated future question" }, { key: "q_authoring_new_key", kind: "single_choice", label: "Choose one", required: false, options: [{ value: "yes", label: "Yes" }] }] });
  event = await data(`${base}/details`, update, 200, true, "PATCH");
  assert.deepEqual(event.availability, beforeAvailability); assert.equal(event.status, "published"); assert.equal(event.alternativeRequestsEnabled, true);
  assert.deepEqual(protectedRows(await snapshot()), protectedRows(beforeDetails));
  const replay = await data(`${base}/details`, update, 200, true, "PATCH"); assert.deepEqual(replay.questions.map((q) => q.key), update.questions.map((q) => q.key));
  assert.equal((await snapshot()).event_questions.filter((row) => row.event_type_id === event.id).length, 2);
  const storedBooking = await data(`/api/app/bookings/${booking.id}`, undefined, 200, true);
  assert.equal(storedBooking.eventTitle, "Original booked title"); assert.equal(storedBooking.durationMinutes, 30); assert.equal(storedBooking.locationValue, "Confidential room 42");
  assert.equal(storedBooking.answers[0].label, originalQuestion.label);
  const publicEvent = (await data("/api/public/events/dial-host/intro")).eventType;
  assert.equal(publicEvent.title, update.title); assert.equal(publicEvent.locationLabel, update.locationLabel);
  for (const key of ["locationValue", "locationType", "availability", "id", "status"]) assert.ok(!Object.hasOwn(publicEvent, key));
  assert.ok(!JSON.stringify(publicEvent).includes(update.locationValue));
  mark("details-only edits preserve windows/status/alternative eligibility and stable supplied question keys on retry; public projection hides private location and committed booking/answer snapshots retain original values");

  const windowsB = [{ weekday: 3, startMinute: 600, endMinute: 660 }, { weekday: 4, startMinute: 720, endMinute: 780 }];
  const baseline = without(await data(base, undefined, 200, true), ["availability", "updatedAt"]);
  await Promise.all([windowsA, windowsB].map((windows) => call(`${base}/availability`, { windows }, 200, true, "PUT")));
  event = await data(base, undefined, 200, true);
  assert.ok([windowsA, windowsB].some((windows) => JSON.stringify(windows) === JSON.stringify(normalizeWindows(event.availability))));
  assert.deepEqual(without(event, ["availability", "updatedAt"]), baseline);
  mark("concurrent native full-window replacements finish as one coherent submitted set, preserving independently edited event details");

  await readiness(event.id, []);
  await probe("mail_check", true); await readiness(event.id, ["transactional_mail"]);
  await call(`${base}/disable`, {}, 200, true); await unchanged(() => call(`${base}/publish`, {}, 409, true));
  await probe("mail_check", false); await probe("check", true); await readiness(event.id, ["destination_calendar"]);
  await probe("check", false); await probe("conference_capability", true);
  event = await data(`${base}/details`, details(event, { locationType: "google_meet", locationLabel: "Google Meet", locationValue: "" }), 200, true, "PATCH");
  await readiness(event.id, ["google_meet_capability"]); await unchanged(() => call(`${base}/publish`, {}, 409, true));
  await probe("conference_capability", false);
  await data(`${base}/availability`, { windows: [] }, 200, true, "PUT"); await readiness(event.id, ["open_availability"]);
  await unchanged(() => call(`${base}/publish`, {}, 409, true));
  await data(`${base}/availability`, { windows: windowsA }, 200, true, "PUT"); await readiness(event.id, []);
  assert.equal((await data(`${base}/publish`, {}, 200, true)).status, "published");
  const activity = (await snapshot()).fixture_activity;
  assert.ok(activity.some((row) => row.kind === "mail_check")); assert.ok(activity.some((row) => row.kind === "check"));
  mark("readiness performs real task-owned mail/calendar/conference probes and publication freshly refuses each missing requirement before healthy publication succeeds");

  for (const kind of ["clear", "meet", "disable", "delete"]) {
    const candidate = await data("/api/app/event-types", full(event, { slug: `probe-${kind}`, locationType: "fixed_link", locationLabel: "Private link", locationValue: "https://private.example.test/authoring", availability: windowsA }), 201, true);
    const path = `/api/app/event-types/${candidate.id}`;
    await probe("conference_capability", true);
    const mutation = () => kind === "clear" ? call(`${path}/availability`, { windows: [] }, 200, true, "PUT") : kind === "meet" ? call(`${path}/details`, details(candidate, { locationType: "google_meet", locationLabel: "Google Meet", locationValue: "" }), 200, true, "PATCH") : kind === "disable" ? call(`${path}/disable`, {}, 200, true) : call(path, undefined, 204, true, "DELETE");
    const refusal = await pausePublish(candidate, mutation, kind === "delete" ? 404 : 409, kind === "disable" ? "disabled" : "draft");
    if (kind === "clear") assert.ok(refusal.error.details.includes("open_availability"));
    await call(`/api/public/events/dial-host/probe-${kind}`, undefined, 404);
  }
  await probe("conference_capability", false);
  const final = await snapshot(); assert.equal(final.fixture_mail.length, 0); assert.equal(final.fixture_events.length, 0);
  mark("in-flight native readiness probes cannot publish stale empty windows, a newly conference-dependent event, or a concurrently disabled/deleted event; no real or synthetic provider sends occur");
  await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, checks, proofs: { stalePublicationRaces: ["windows cleared", "fixed link changed to Google Meet", "disabled", "deleted"], existingBookingId: booking.id, providerSendEffects: 0 }, limits: ["Native Hono/Start/D1/DO with task-owned synthetic providers and fresh temporary state only.", "Host authoring browser controls, reload state and client error retention remain unverified under the explicit browser launch hold.", "Readiness reads may update derived calendar health/busy cache; no-write assertions cover the product tables included by the retained diagnostic snapshot."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, failure: error.message, stack: error.stack }, null, 2) + "\n"); throw error;
}
