import { evidencePath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { authenticate, call, data, snapshot, origin } from "../tests/dst-native/helpers.mjs";

const checks = [];

// Keep both transitions in the next real calendar year. The isolated worker
// uses January 1 of that year so the fold stays inside the 365-day horizon.
const year = new Date().getUTCFullYear() + 1;
const sunday = (month, ordinal) => {
  const first = new Date(Date.UTC(year, month - 1, 1));
  first.setUTCDate(1 + (7 - first.getUTCDay()) % 7 + 7 * (ordinal - 1));
  return first.toISOString().slice(0, 10);
};
const foldDate = sunday(11, 1);
const springDate = sunday(3, 2);
const utc = (date, hour, minute = 0) => new Date(Date.parse(date + "T00:00:00Z") + (hour * 60 + minute) * 60_000).toISOString();
const afterFold = (days) => new Date(Date.parse(foldDate + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const monday = afterFold(1);
const tuesday = afterFold(2);

const fixture = await data("/__fixtures/setup", {});
await authenticate(fixture.operatorEmail);
const profile = await data("/api/app/profile", undefined, 200, true);
await data("/api/app/profile", { ...profile, timezone: "America/New_York" }, 200, true, "PATCH");
const event = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
const input = { ...event, durationMinutes: 120, durationOptionsMinutes: [120], slotIncrementMinutes: 15, bookingHorizonDays: 365, minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [{ weekday: 0, startMinute: 90, endMinute: 210 }] };
const update = async (patch) => { Object.assign(input, patch, { durationOptionsMinutes: [patch.durationMinutes ?? input.durationMinutes] }); await data(`/api/app/event-types/${fixture.eventId}`, input, 200, true, "PATCH"); };
const slots = async (week) => (await data(`/api/public/book/dial-host/intro/availability?week=${week}`)).slots.filter((slot) => slot.hostDate === week);
const select = (startAt, expected) => call("/api/public/book/dial-host/intro/selection", { startAt, inviteeTimezone: "UTC" }, expected);
const unchanged = async (before) => {
  const after = await snapshot();
  for (const table of ["bookings", "booking_occurrences", "booking_nonces", "delivery_outbox", "fixture_events", "fixture_mail"]) assert.deepEqual(after[table], before[table], table);
};
await update({});
assert.deepEqual(await slots(springDate), []);
let before = await snapshot();
assert.equal((await (await select(utc(springDate, 6, 30), 409)).json()).error.code, "slot_unavailable");
await unchanged(before); checks.push("Spring duration overshoot absent from native offers and fresh selection; no booking/nonce/effects");
await update({ durationMinutes: 90, availability: [{ weekday: 0, startMinute: 60, endMinute: 120 }] });
assert.deepEqual((await slots(foldDate)).map((slot) => slot.startAt), [utc(foldDate, 5, 0), utc(foldDate, 5, 15), utc(foldDate, 5, 30)]);
before = await snapshot(); await select(utc(foldDate, 6, 0), 409); await unchanged(before);
const selection = await (await select(utc(foldDate, 5, 30), 201)).json();
const body = { nonce: selection.nonce, startAt: selection.selection.startAt, inviteeTimezone: "UTC", name: "Synthetic fold invitee", email: "fold-duration@dial.test", answers: {} };
const receipt = await data("/api/public/book/dial-host/intro/confirm", body, 201);
const replay = await data("/api/public/book/dial-host/intro/confirm", body, 200); assert.deepEqual(replay, receipt);
let state = await snapshot(); assert.equal(state.bookings.length, 1); assert.equal(state.booking_occurrences.length, 1);
assert.equal(state.booking_occurrences[0].start_at, utc(foldDate, 5, 30)); assert.equal(state.booking_occurrences[0].end_at, utc(foldDate, 7, 0));
const token = new URL(receipt.manageUrl).pathname.split("/").at(-1);
await data(`/api/public/manage/${token}/cancel`, {}); state = await snapshot(); assert.equal(state.bookings[0].state, "cancelled");
checks.push("Contained 90-minute fold offered/claimed with exact UTC duration; rejected late fold; confirmation replay and cancellation preserved");
await update({ durationMinutes: 45, availability: [{ weekday: 0, startMinute: 90, endMinute: 120 }] });
assert.deepEqual(await slots(foldDate), []); before = await snapshot(); await select(utc(foldDate, 5, 30), 409); await unchanged(before);
await update({ durationMinutes: 30 }); assert.deepEqual((await slots(foldDate)).map((slot) => slot.startAt), [utc(foldDate, 5, 30), utc(foldDate, 6, 30)]);
checks.push("Narrow fold cannot bridge closed wall minutes; both exact half-open 30-minute boundaries remain offered");
await update({ durationMinutes: 90, availability: [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 600, endMinute: 660 }] });
assert.deepEqual(await slots(monday), []); before = await snapshot(); await select(utc(monday, 14, 0), 409); await unchanged(before);
checks.push("Adjacent published windows cannot merge into a longer native offer or fresh claim");
await data(`/api/app/event-types/${fixture.eventId}/availability-overrides/${monday}`, { mode: "open", windows: [{ startMinute: 540, endMinute: 660 }] }, 200, true, "PUT");
assert.deepEqual((await slots(monday)).map((slot) => slot.startAt), [utc(monday, 14, 0), utc(monday, 14, 15), utc(monday, 14, 30)]);
checks.push("Date override replaces separate recurrence with one valid containing window");
// A stored host-date cap survives a later profile timezone change.
await call(`/api/app/event-types/${fixture.eventId}/availability-overrides/${monday}`, undefined, 204, true, "DELETE");
assert.equal((await data(`/api/app/event-types/${fixture.eventId}/availability-overrides`, undefined, 200, true)).some((override) => override.hostDate === monday), false);
await call(`/api/app/event-types/${fixture.eventId}/availability-overrides/${monday}`, undefined, 404, true, "DELETE");
assert.deepEqual(await slots(monday), []);
checks.push("Override deletion with dependent windows returns204, restores recurrence, and repeats404 honestly");
await data("/api/app/profile", { ...profile, timezone: "America/Los_Angeles" }, 200, true, "PATCH");
await update({ durationMinutes: 30, hostDayBookingLimit: 1, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) });
const operatorCreated = await data("/api/app/bookings", { eventTypeId: fixture.eventId, startAt: utc(tuesday, 7, 30), inviteeTimezone: "UTC", name: "Synthetic stored-date invitee", email: "stored-date-cap@dial.test", answers: {}, overrideNoticeAndHorizon: false }, 201, true);
state = await snapshot();
const active = state.bookings.find((booking) => booking.id === operatorCreated.id);
assert.equal(active.host_timezone, "America/Los_Angeles");
assert.equal(state.booking_occurrences.find((occurrence) => occurrence.booking_id === active.id).host_date, monday);
await data("/api/app/profile", { ...profile, timezone: "UTC" }, 200, true, "PATCH");
assert.deepEqual(await slots(monday), []);
before = await snapshot(); await select(utc(monday, 10, 0), 409); await unchanged(before);
await data(`/api/app/bookings/${active.id}/cancel`, {}, 200, true);
checks.push("Stored host-date cap survives profile timezone change outside the narrow UTC read; denied selection writes nothing");
await writeFile(evidencePath("dst-containment-native.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, proof: "Production Hono/Start/D1/DO local runtime with task-owned synthetic calendar/mail", checks, limits: ["No browser launched", "No live-provider or load/p95 acceptance"] }, null, 2) + "\n");
console.log(checks.map((check) => `PASS ${check}`).join("\n"));
