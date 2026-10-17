import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { authenticate, call, control, data, origin, privateBusy, productRecords, setBusy, snapshot } from "../tests/availability-diagnostics/helpers.mjs";

const evidencePath = outputPath("availability-diagnostics-native.json"), checks = [], proofs = [];
const mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
const allRules = ["schedule", "date_override", "start_increment", "minimum_notice", "horizon", "buffer", "host_day_limit", "dial_booking", "calendar_busy"];
const privateMarkers = ["Secret external offsite", "private-provider-event-identity", "private-external-attendee@dial.test", "Private claim invitee", "private-claim@dial.test", "Confidential claim answer"];
const labels = { schedule: "scheduled windows", date_override: "availability override", start_increment: "start increment", minimum_notice: "minimum notice", horizon: "booking horizon", buffer: "time buffers", host_day_limit: "host-day booking limit", dial_booking: "existing Dial booking", calendar_busy: "conflict-calendar busy time" };
const futureDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const dayPlus = (date, days) => new Date(Date.parse(date + "T00:00:00.000Z") + days * 86400000).toISOString().slice(0, 10);
const at = (date, minute) => new Date(Date.parse(date + "T00:00:00.000Z") + minute * 60_000).toISOString();
const providerEffects = (state) => ({ calendar: state.fixture_events, mail: state.fixture_mail });
let fixture, event, questionKey;
async function noProductWrites(action) {
  const before = await snapshot(), result = await action(), after = await snapshot();
  assert.deepEqual(productRecords(after), productRecords(before), "diagnosis and refusal must not alter product records");
  assert.deepEqual(providerEffects(after), providerEffects(before), "diagnosis and refusal must not issue provider effects");
  return result;
}
function assertPrivate(value) { const bytes = JSON.stringify(value); for (const marker of privateMarkers) assert.ok(!bytes.includes(marker), `private marker leaked: ${marker}`); }
function assertDiagnosis(result, startAt, exclusions) {
  assert.deepEqual(Object.keys(result).sort(), ["endAt", "exclusions", "hostDate", "hostTimezone", "startAt", "valid"]);
  assert.deepEqual({ startAt: result.startAt, endAt: result.endAt, hostDate: result.hostDate, hostTimezone: result.hostTimezone }, { startAt: new Date(startAt).toISOString(), endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(), hostDate: new Date(startAt).toISOString().slice(0, 10), hostTimezone: "UTC" });
  assert.equal(result.valid, exclusions.length === 0); assert.deepEqual([...result.exclusions].sort(), [...exclusions].sort());
  assert.ok(result.exclusions.every((rule) => allRules.includes(rule))); assertPrivate(result);
}
const query = (startAt, override = false, extra = {}) => new URLSearchParams({ startAt, overrideNoticeAndHorizon: String(override), ...extra });
const path = (startAt, override = false, extra) => `/api/app/event-types/${fixture.eventId}/availability-diagnostics?${query(startAt, override, extra)}`;
async function diagnose(startAt, exclusions, override = false, extra) {
  const result = await noProductWrites(() => data(path(startAt, override, extra), undefined, 200, true)); assertDiagnosis(result, startAt, exclusions); return result;
}
const body = (startAt, changes = {}) => ({ idempotencyKey: randomUUID(), eventTypeId: fixture.eventId, startAt, inviteeTimezone: "UTC", name: "Synthetic diagnostic invitee", email: "diagnostic-invitee@dial.test", answers: { [questionKey]: "Synthetic diagnostic answer" }, overrideNoticeAndHorizon: false, ...changes });
async function denial(response, exclusions) {
  const result = await response.json(); assert.equal(result.error.code, "slot_unavailable");
  assert.deepEqual([...result.error.details].sort(), [...exclusions].sort());
  for (const rule of exclusions) assert.ok(result.error.message.includes(labels[rule])); assertPrivate(result); return result;
}
async function createDenied(startAt, exclusions, override = false) {
  await diagnose(startAt, exclusions, override);
  return noProductWrites(async () => denial(await call("/api/app/bookings", body(startAt, { overrideNoticeAndHorizon: override }), 409, true), exclusions));
}
async function configure(changes) {
  const fields = ["slug", "title", "description", "durationMinutes", "color", "locationType", "locationLabel", "locationValue", "listed", "alternativeRequestsEnabled", "slotIncrementMinutes", "minimumNoticeMinutes", "bookingHorizonDays", "bookingHorizonMode", "bookingStartDate", "bookingEndDate", "beforeBufferMinutes", "afterBufferMinutes", "hostDayBookingLimit", "questions", "availability"];
  event = await data(`/api/app/event-types/${fixture.eventId}`, { ...Object.fromEntries(fields.map((field) => [field, event[field]])), ...changes }, 200, true, "PATCH");
}

try {
  fixture = await data("/__fixtures/setup", {}); await authenticate(fixture.operatorEmail);
  event = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true); questionKey = event.questions[0].key;
  await configure({ availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 720 })) });
  await configure({ slotIncrementMinutes: 45, minimumNoticeMinutes: 0 });
  const offers = await data(`/api/public/book/dial-host/${event.slug}/availability?week=${futureDate}`);
  assert.deepEqual(offers.slots.filter(slot => slot.hostDate === futureDate).map(slot => slot.startAt), [540, 585, 630, 675].map(minute => at(futureDate, minute)));
  await configure({ bookingHorizonMode: "fixed_range", bookingStartDate: dayPlus(futureDate, 1), bookingEndDate: dayPlus(futureDate, 2) });
  await diagnose(at(futureDate, 540), ["horizon"]);
  await diagnose(at(dayPlus(futureDate, 1), 540), []);
  await diagnose(at(dayPlus(futureDate, 3), 540), ["horizon"]);
  await noProductWrites(() => data(`/api/app/event-types/${fixture.eventId}/details`, { ...event, bookingStartDate: dayPlus(futureDate, 3), bookingEndDate: futureDate, availability: undefined, alternativeRequestsEnabled: undefined }, 400, true, "PATCH"));
  const today = new Date().toISOString().slice(0, 10);
  let tenthWeekday = today, weekdays = 0;
  while (weekdays < 10) { tenthWeekday = dayPlus(tenthWeekday, 1); if (![0,6].includes(new Date(tenthWeekday + "T12:00:00Z").getUTCDay())) weekdays++; }
  await configure({ bookingHorizonMode: "weekdays", bookingHorizonDays: 10 });
  await diagnose(at(tenthWeekday, 540), []);
  await diagnose(at(dayPlus(tenthWeekday, 1), 540), ["horizon"]);
  await configure({ bookingHorizonMode: "indefinite" });
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../seed.json", import.meta.url), "utf8"));
  await diagnose(at(dayPlus(today, manifest.limits.availabilityLookaheadDays), 540), []);
  await diagnose(at(dayPlus(today, manifest.limits.availabilityLookaheadDays + 1), 540), ["horizon"]);
  await configure({ slotIncrementMinutes: 15, minimumNoticeMinutes: 240, bookingHorizonMode: "calendar_days", bookingHorizonDays: 60, bookingStartDate: null, bookingEndDate: null });
  mark("45-minute offers, inclusive fixed dates, ten-weekday counting and bounded indefinite horizons use the same authoritative diagnostics and public offers");
  const selected = at(futureDate, 540);
  await noProductWrites(async () => {
    await call(path(selected), undefined, 401);
    await call("/api/app/event-types/not-an-id/availability-diagnostics", undefined, 401);
    for (const malformed of ["not-an-instant", selected.replace("Z", "+01:00")]) await call(path(malformed), undefined, 400, true);
    for (const fractional of [".0001Z", ".0011Z"]) {
      const unsupported = selected.replace(".000Z", fractional);
      await call(path(unsupported), undefined, 400, true);
      await call("/api/app/bookings", body(unsupported), 400, true);
    }
    await call(`/api/app/event-types/${fixture.eventId}/availability-diagnostics`, undefined, 400, true);
    for (const invalid of ["TRUE", "1", "yes"]) await call(`/api/app/event-types/${fixture.eventId}/availability-diagnostics?${query(selected, false, { overrideNoticeAndHorizon: invalid })}`, undefined, 400, true);
    await call(`/api/app/event-types/${"A".repeat(26)}/availability-diagnostics?${query(selected)}`, undefined, 404, true);
  });
  await diagnose(selected, []); await diagnose(selected.replace(".000Z", "Z"), []); await diagnose(selected.replace(".000Z", ".0000Z"), []);
  await noProductWrites(async () => assertDiagnosis(await data(`/api/app/event-types/${fixture.eventId}/availability-diagnostics?${new URLSearchParams({ startAt: selected })}`, undefined, 200, true), selected, []));
  mark("native diagnostics require a session and valid UTC/boolean inputs; sub-millisecond values are refused without writes while no-millisecond and zero-only aliases preserve the canonical valid rule-only projection");

  await createDenied(at(futureDate, 510), ["schedule"]);
  await createDenied(at(futureDate, 545), ["start_increment"]);
  await createDenied(selected.replace(":00.000Z", ":30.000Z"), ["start_increment"]);
  await diagnose(selected.replace(".000Z", ".001Z"), ["start_increment"]);
  await diagnose(at(futureDate, 510), ["schedule"], false, { overridePublishedAvailability: "true" });
  await data(`/api/app/event-types/${fixture.eventId}/availability-overrides/${futureDate}`, { mode: "closed", windows: [] }, 200, true, "PUT");
  await createDenied(selected, ["date_override"]);
  await data(`/api/app/event-types/${fixture.eventId}/availability-overrides/${futureDate}`, { mode: "open", windows: [{ startMinute: 600, endMinute: 660 }] }, 200, true, "PUT");
  await createDenied(selected, ["date_override"]); await diagnose(at(futureDate, 600), []);
  await call(`/api/app/event-types/${fixture.eventId}/availability-overrides/${futureDate}`, undefined, 204, true, "DELETE");
  mark("schedule, minute/second/fractional increment and replacement/closed-date rules are named consistently in private diagnostics and native creation denials without writes");

  await configure({ minimumNoticeMinutes: 7 * 24 * 60, bookingHorizonDays: 1 });
  await createDenied(selected, ["minimum_notice", "horizon"]); await diagnose(selected, [], true);
  await configure({ minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 15, afterBufferMinutes: 15 });
  mark("notice and horizon exclusions are named and only the explicit timing override relaxes those rules");

  for (const [busy, rules] of [
    [privateBusy(at(futureDate, 520), at(futureDate, 525)), []],
    [privateBusy(at(futureDate, 520), at(futureDate, 526)), ["calendar_busy", "buffer"]],
    [privateBusy(at(futureDate, 585), at(futureDate, 600)), []],
    [privateBusy(at(futureDate, 584), at(futureDate, 600)), ["calendar_busy", "buffer"]],
    [privateBusy(at(futureDate, 550), at(futureDate, 560)), ["calendar_busy"]],
  ]) {
    await setBusy([busy]); await diagnose(selected, rules, true);
    if (rules.length) await createDenied(selected, rules);
  }
  await setBusy();
  mark("fresh external busy reads distinguish core overlap from buffer-only overlap and keep both exclusive boundaries; private provider title, identity and attendee never appear");

  await control(true);
  await noProductWrites(async () => {
    const failure = await data(path(selected), undefined, 503, true);
    assert.equal(failure.error.code, "calendar_provider_unavailable"); assert.ok(!Object.hasOwn(failure, "valid")); assert.ok(!Object.hasOwn(failure, "exclusions")); assertPrivate(failure);
    await call("/api/app/bookings", body(selected), 503, true);
  });
  await control(false); await call("/__fixtures/calendar-health", { healthy: true }, 204); await diagnose(selected, []);
  mark("required fresh provider failure returns503 with no invented valid result or exclusion list and no product/provider effects; recovery returns a real valid diagnosis");

  const claimBody = body(at(futureDate, 600).replace(".000Z", "Z"), { name: "Private claim invitee", email: "private-claim@dial.test", answers: { [questionKey]: "Confidential claim answer" } });
  const claim = await data("/api/app/bookings", claimBody, 201, true); privateMarkers.push(claim.id);
  assert.equal(claim.occurrence.startAt, at(futureDate, 600)); assert.equal(claim.occurrence.endAt, at(futureDate, 630));
  await noProductWrites(async () => assert.equal((await data("/api/app/bookings", { ...claimBody, startAt: at(futureDate, 600) }, 200, true)).id, claim.id));
  await noProductWrites(async () => assert.equal((await data("/api/app/bookings", { ...claimBody, startAt: at(futureDate, 600).replace(".000Z", ".0000Z") }, 200, true)).id, claim.id));
  await diagnose(at(futureDate, 600), ["dial_booking"]);
  await diagnose(at(futureDate, 570), ["dial_booking", "buffer"]);
  await diagnose(selected, []);
  await diagnose(at(futureDate, 600), ["dial_booking"], true, { excludedBookingId: claim.id });
  await createDenied(at(futureDate, 570), ["dial_booking", "buffer"]);
  await configure({ hostDayBookingLimit: 1 });
  await diagnose(at(futureDate, 660), ["host_day_limit"], true); await createDenied(at(futureDate, 660), ["host_day_limit"], true);
  await configure({ hostDayBookingLimit: null });
  mark("real native no-millisecond creation and same-key canonical replay agree; current stored claim core/buffers and host-day caps are attributed without leaking booking identity or invitee payload");

  const proposed = at(dayPlus(futureDate, 3), 540), misaligned = at(dayPlus(futureDate, 3), 545);
  await diagnose(misaligned, ["start_increment"]);
  await noProductWrites(async () => denial(await call(`/api/app/bookings/${claim.id}/reschedule`, { startAt: misaligned, inviteeTimezone: "UTC" }, 409, true), ["start_increment"]));
  await setBusy([privateBusy(proposed, at(dayPlus(futureDate, 3), 550))]);
  await noProductWrites(async () => denial(await call(`/api/app/bookings/${claim.id}/reschedule`, { startAt: proposed, inviteeTimezone: "UTC", overridePublishedAvailability: true }, 409, true), ["calendar_busy"]));
  await setBusy();
  const moved = await data(`/api/app/bookings/${claim.id}/reschedule`, { startAt: proposed.replace(".000Z", "Z"), inviteeTimezone: "UTC" }, 200, true);
  assert.equal(moved.id, claim.id); assert.equal(moved.icalUid, claim.icalUid); assert.equal(moved.occurrence.sequence, 1); assert.equal(moved.occurrence.startAt, proposed);
  await diagnose(at(futureDate, 600), []);
  mark("native reschedule errors name the same increment/busy rules without mutation; published-window override cannot bypass busy time, and valid no-millisecond movement preserves identity while releasing the old current claim");

  const raceAt = at(dayPlus(futureDate, 1), 600); await diagnose(raceAt, []); await control(false, 150);
  const beforeRace = await snapshot();
  const racers = await Promise.all([0, 1].map((index) => call("/api/app/bookings", body(raceAt, { email: `race-${index}@dial.test` }), [201, 409], true)));
  await control(false);
  assert.equal(racers.filter((response) => response.status === 201).length, 1); assert.equal(racers.filter((response) => response.status === 409).length, 1);
  const raceAfter = await snapshot(); assert.equal(raceAfter.bookings.length, beforeRace.bookings.length + 1); assert.equal(raceAfter.booking_occurrences.length, beforeRace.booking_occurrences.length + 1); assert.equal(raceAfter.booking_history.length, beforeRace.booking_history.length + 1);
  assert.equal(raceAfter.booking_occurrences.filter((row) => row.start_at === raceAt && row.is_current === 1).length, 1);
  await diagnose(raceAt, ["dial_booking"]);
  mark("a valid diagnostic grants no claim; concurrent native attempts for the same free time still commit exactly one booking, occurrence and history entry");

  const publicAt = at(dayPlus(futureDate, 2), 540), selection = await data("/api/public/book/dial-host/intro/selection", { startAt: publicAt, inviteeTimezone: "UTC" }, 201);
  const confirmation = { nonce: selection.nonce, startAt: publicAt, inviteeTimezone: "UTC", name: "Public diagnostic invitee", email: "public-diagnostic@dial.test", answers: { [questionKey]: "Synthetic public answer" } };
  await setBusy([privateBusy(at(dayPlus(futureDate, 2), 550), at(dayPlus(futureDate, 2), 560))]);
  await diagnose(publicAt, ["calendar_busy"]);
  await noProductWrites(async () => {
    const denied = await data("/api/public/book/dial-host/intro/confirm", confirmation, 409);
    assert.equal(denied.error.code, "slot_unavailable"); assert.ok(!Object.hasOwn(denied.error, "details"));
    assert.ok(!JSON.stringify(denied).includes("calendar_busy")); assert.ok(!JSON.stringify(denied).includes("exclusions")); assertPrivate(denied);
  });
  await setBusy(); await data("/api/public/book/dial-host/intro/confirm", confirmation, 201);
  const final = await snapshot(); assert.equal(final.bookings.filter((row) => row.invitee_email === confirmation.email).length, 1);
  assert.equal(final.fixture_events.length, 0); assert.equal(final.fixture_mail.length, 0);
  mark("public confirmation refusals remain neutral without private rules/details and preserve the nonce for one successful exact retry after busy time clears");
  proofs.push({ rulesVerified: allRules, canonicalOperatorCreateAndReplay: true, currentClaimIdentityHidden: true, concurrentClaimsCommitted: 1, providerSendEffects: 0, publicRetryBookings: 1 });
  await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, proofs, limits: ["Native Hono/Start/D1/DO only; operator UI rendering and browser behavior remain unverified under the launch hold.", "Product-write assertions cover configuration, booking/request records, capabilities, history, delivery commands/attempts, erasure audit and retry receipts. Fresh provider reads may update derived busy cache and connection health; admission state and fixture read activity are outside those assertions.", "Synthetic external event metadata is injected only through the task-owned calendar adapter. No real calendar/mail provider or credentials are used. Future notification commands remain queued; none were sent by this fixture."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, proofs, failure: error.message, stack: error.stack }, null, 2) + "\n");
  throw error;
}
