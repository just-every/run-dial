import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const availability = await loadAvailability();
const now = new Date("2030-06-01T00:00:00.000Z");
const selected = "2030-06-03T09:00:00.000Z";
const ordinaryRange = { startAt: "2030-06-02T23:45:00.000Z", endAt: "2030-06-04T00:20:00.000Z", freshness: "fresh" };
function fixture(changes = {}) {
  const profile = { id: "synthetic-host", timezone: changes.zone ?? "UTC" };
  const event = { id: "synthetic-event", durationMinutes: 30, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 15, afterBufferMinutes: 20, hostDayBookingLimit: null,
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 600 })), ...changes.event };
  const calendarReads = [], claimReads = [], overrideReads = [];
  const claims = changes.claims ?? [], busy = changes.busy ?? [];
  const service = new availability.AvailabilityService(
    { async listOwnCalendarEvents() { return []; }, async listInternalClaims(startAt, endAt, excludedBookingId, capHostDates) { claimReads.push([startAt, endAt, excludedBookingId, capHostDates]); return claims.filter((claim) => (!excludedBookingId || claim.bookingId !== excludedBookingId) && (overlaps(claim, startAt, endAt) || capHostDates.includes(claim.hostDate))); } },
    { async getPublicProfile() { return profile; }, async getProfile() { return profile; } },
    { async resolvePublishedEventForPublicRequest() { return event; }, async getEventType() { return event; }, async listDateAvailabilityOverrides(id) { overrideReads.push(id); return changes.overrideFailure ? undefined : changes.overrides ?? []; } },
    { async readBusy(range) { calendarReads.push(range); return changes.providerFailure ? { kind: "unavailable", code: "synthetic_failure" } : { kind: "ok", calendarRequired: true, observedAt: now.toISOString(), intervals: busy.filter((interval) => overlaps(interval, range.startAt, range.endAt)) }; } },
  );
  return { service, profile, event, calendarReads, claimReads, overrideReads,
    publicSelection: (startAt = selected, at = now, excludedBookingId) => service.verifyPublicSelection("synthetic-host", "synthetic-event", startAt, at, excludedBookingId),
    operatorSelection: (startAt = selected, options = { overrideNoticeAndHorizon: false }, at = now, excludedBookingId) => service.verifyOperatorSelection(event.id, startAt, options, at, excludedBookingId),
  };
}
function overlaps(interval, startAt, endAt) { return Date.parse(interval.startAt) < Date.parse(endAt) && Date.parse(interval.endAt) > Date.parse(startAt); }
function assertRange(proof, expected, excludedBookingId, capHostDates = []) {
  assert.deepEqual(proof.calendarReads, [expected]);
  assert.deepEqual(proof.claimReads, [[expected.startAt, expected.endAt, excludedBookingId, capHostDates]]);
  assert.deepEqual(proof.overrideReads, [proof.event.id]);
}
function assertValid(result, startAt = selected, endAt = "2030-06-03T09:30:00.000Z", hostDate = "2030-06-03", hostOffset = "UTC+00:00") {
  assert.equal(result.kind, "valid");
  assert.deepEqual(result.slot, { startAt, endAt, hostDate, hostOffset });
  assert.equal(result.calendarRequired, true, "a connected calendar remains required for the verified selection");
}

contract("AVAIL-003", "public and operator fresh selection read one ordinary host day with buffers and excluded booking claims", async () => {
  for (const method of ["publicSelection", "operatorSelection"]) {
    const proof = fixture({ claims: [{ bookingId: "own-booking", hostDate: "2030-06-03", startAt: "2030-06-03T08:45:00.000Z", endAt: "2030-06-03T09:50:00.000Z" }] });
    const result = method === "publicSelection" ? await proof[method](selected, now, "own-booking") : await proof[method](selected, { overrideNoticeAndHorizon: false }, now, "own-booking");
    assertValid(result); assertRange(proof, ordinaryRange, "own-booking");
    const notExcluded = fixture({ claims: [{ bookingId: "other-booking", hostDate: "2030-06-03", startAt: "2030-06-03T08:45:00.000Z", endAt: "2030-06-03T09:50:00.000Z" }] });
    assert.equal((await notExcluded[method]()).kind, "slot_invalid");
  }
});

contract("AVAIL-006", "a fresh folded selection includes all 25 host hours and buffers for either selector", async () => {
  for (const method of ["publicSelection", "operatorSelection"]) {
    const proof = fixture({ zone: "America/New_York", event: { availability: [{ weekday: 0, startMinute: 60, endMinute: 120 }] } });
    const startAt = "2026-11-01T06:30:00.000Z", at = new Date("2026-10-01T00:00:00.000Z");
    const result = method === "publicSelection" ? await proof[method](startAt, at, "fold-booking") : await proof[method](startAt, { overrideNoticeAndHorizon: false }, at, "fold-booking");
    assertValid(result, startAt, "2026-11-01T07:00:00.000Z", "2026-11-01", "UTC-05:00");
    assertRange(proof, { startAt: "2026-11-01T03:45:00.000Z", endAt: "2026-11-02T05:20:00.000Z", freshness: "fresh" }, "fold-booking");
  }
});

contract("AVAIL-002", "fresh selection keeps exclusive busy boundaries and reads occupancy in buffers outside midnight", async () => {
  const abutting = fixture({ busy: [{ startAt: "2030-06-03T08:30:00.000Z", endAt: "2030-06-03T08:45:00.000Z" }, { startAt: "2030-06-03T09:50:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }] });
  assertValid(await abutting.publicSelection());
  for (const busy of [{ startAt: "2030-06-03T08:30:00.000Z", endAt: "2030-06-03T08:46:00.000Z" }, { startAt: "2030-06-03T09:49:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }]) {
    assert.equal((await fixture({ busy: [busy] }).publicSelection()).kind, "slot_invalid");
  }
  const midnight = "2030-06-03T00:00:00.000Z", last = "2030-06-03T23:30:00.000Z";
  const windows = { availability: [{ weekday: 1, startMinute: 0, endMinute: 30 }, { weekday: 1, startMinute: 1410, endMinute: 1440 }] };
  for (const [startAt, busy] of [[midnight, { startAt: "2030-06-02T23:50:00.000Z", endAt: "2030-06-03T00:00:00.000Z" }], [last, { startAt: "2030-06-04T00:10:00.000Z", endAt: "2030-06-04T00:15:00.000Z" }]]) {
    const proof = fixture({ event: windows, busy: [busy] });
    assert.equal((await proof.publicSelection(startAt)).kind, "slot_invalid"); assertRange(proof, ordinaryRange);
  }
});

contract("AVAIL-002", "one-day fresh verification preserves notice and horizon exact boundaries", async () => {
  const notice = { minimumNoticeMinutes: 30 };
  assert.equal((await fixture({ event: notice }).publicSelection(selected, new Date("2030-06-03T08:31:00.000Z"))).kind, "slot_invalid");
  assertValid(await fixture({ event: notice }).publicSelection(selected, new Date("2030-06-03T08:30:00.000Z")));
  const horizon = { bookingHorizonDays: 2 };
  assert.equal((await fixture({ event: horizon }).publicSelection(selected, new Date("2030-06-01T08:59:00.000Z"))).kind, "slot_invalid");
  assertValid(await fixture({ event: horizon }).publicSelection(selected, new Date("2030-06-01T09:00:00.000Z")));
});

contract("AVAIL-002", "host-day caps count current claims elsewhere on the selected day and exclude an owned booking", async () => {
  const claim = { bookingId: "own-booking", hostDate: "2030-06-03", startAt: "2030-06-03T15:00:00.000Z", endAt: "2030-06-03T16:00:00.000Z" };
  const proof = fixture({ event: { hostDayBookingLimit: 1 }, claims: [claim] });
  assert.equal((await proof.publicSelection()).kind, "slot_invalid");
  assertRange(proof, ordinaryRange, undefined, ["2030-06-03"]);
  assertValid(await fixture({ event: { hostDayBookingLimit: 1 }, claims: [claim] }).publicSelection(selected, now, "own-booking"));
  const adjacentDay = { ...claim, hostDate: "2030-06-02", startAt: "2030-06-02T23:45:00.000Z", endAt: "2030-06-02T23:50:00.000Z" };
  assertValid(await fixture({ event: { hostDayBookingLimit: 1 }, claims: [adjacentDay] }).publicSelection());
});

contract("AVAIL-002", "persisted host dates still count toward a daily cap after timezone changes move their UTC intervals outside the selected day", async () => {
  const shiftedClaim = { bookingId: "existing-booking", hostDate: "2030-06-03", startAt: "2030-06-04T02:00:00.000Z", endAt: "2030-06-04T03:00:00.000Z" };
  for (const method of ["publicSelection", "operatorSelection"]) {
    const capped = fixture({ event: { hostDayBookingLimit: 1 }, claims: [shiftedClaim] });
    assert.equal((await capped[method]()).kind, "slot_invalid"); assertRange(capped, ordinaryRange, undefined, ["2030-06-03"]);
    const uncapped = fixture({ claims: [shiftedClaim] });
    assertValid(await uncapped[method]()); assertRange(uncapped, ordinaryRange);
    const excluding = fixture({ event: { hostDayBookingLimit: 1 }, claims: [shiftedClaim] });
    const result = method === "publicSelection" ? await excluding[method](selected, now, shiftedClaim.bookingId) : await excluding[method](selected, { overrideNoticeAndHorizon: false }, now, shiftedClaim.bookingId);
    assertValid(result); assertRange(excluding, ordinaryRange, shiftedClaim.bookingId, ["2030-06-03"]);
  }
});

contract("AVAIL-004", "required provider or override failures close both fresh selectors without using known available times", async () => {
  for (const method of ["publicSelection", "operatorSelection"]) {
    for (const failure of [{ providerFailure: true }, { overrideFailure: true }]) {
      const proof = fixture(failure);
      assert.deepEqual(await proof[method](), { kind: "calendar_unavailable" }); assertRange(proof, ordinaryRange);
    }
  }
});

contract("AVAIL-004", "public display still reads seven cached host days and returns all seven days of slots", async () => {
  const proof = fixture({ event: { hostDayBookingLimit: 2 } });
  const result = await proof.service.listPublicWeek("synthetic-host", "synthetic-event", "2030-06-03", "Asia/Kathmandu", now);
  assertRange(proof, { startAt: "2030-06-02T23:45:00.000Z", endAt: "2030-06-10T00:20:00.000Z", freshness: "cached" }, undefined, ["2030-06-03", "2030-06-04", "2030-06-05", "2030-06-06", "2030-06-07", "2030-06-08", "2030-06-09"]);
  assert.equal(result.state, "available"); assert.equal(result.week, "2030-06-03");
  assert.equal(result.calendarRequired, true, "connected-calendar availability retains its calendar obligation");
  assert.deepEqual([...new Set(result.slots.map((slot) => slot.hostDate))], ["2030-06-03", "2030-06-04", "2030-06-05", "2030-06-06", "2030-06-07", "2030-06-08", "2030-06-09"]);
  assert.equal(result.slots.length, 14); assert.equal(result.recommendations.length, 5);
  assertValid(await fixture().publicSelection(result.slots[0].startAt));
});

contract("BOOK-012", "operator notice and horizon override remains separate from published-window override", async () => {
  const timing = { minimumNoticeMinutes: 3 * 24 * 60, bookingHorizonDays: 1 };
  assert.equal((await fixture({ event: timing }).operatorSelection()).kind, "slot_invalid");
  assertValid(await fixture({ event: timing }).operatorSelection(selected, { overrideNoticeAndHorizon: true }));
  const closed = [{ hostDate: "2030-06-03", mode: "closed", windows: [] }];
  assert.equal((await fixture({ event: timing, overrides: closed }).operatorSelection(selected, { overrideNoticeAndHorizon: true })).kind, "slot_invalid");
  const changedStart = "2030-06-03T09:07:00.000Z";
  assertValid(await fixture({ event: timing, overrides: closed }).operatorSelection(changedStart, { overrideNoticeAndHorizon: true, overridePublishedAvailability: true }), changedStart, "2030-06-03T09:37:00.000Z");
  assert.equal((await fixture({ event: timing, overrides: closed }).operatorSelection(changedStart, { overrideNoticeAndHorizon: false, overridePublishedAvailability: true })).kind, "slot_invalid");
  for (const conflict of [
    { busy: [{ startAt: "2030-06-03T09:35:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }] },
    { claims: [{ bookingId: "other", hostDate: "2030-06-03", startAt: "2030-06-03T08:50:00.000Z", endAt: "2030-06-03T09:00:00.000Z" }] },
    { event: { hostDayBookingLimit: 1 }, claims: [{ bookingId: "other", hostDate: "2030-06-03", startAt: "2030-06-03T15:00:00.000Z", endAt: "2030-06-03T16:00:00.000Z" }] },
  ]) {
    assert.equal((await fixture({ overrides: closed, ...conflict }).operatorSelection(changedStart, { overrideNoticeAndHorizon: true, overridePublishedAvailability: true })).kind, "slot_invalid");
  }
});

contract("BOOK-001", "public capability selection retains exact labels while operator instants canonicalize to actual offers", async () => {
  assertValid(await fixture().publicSelection());
  for (const startAt of ["2030-06-03T09:00:00Z", "2030-06-03T11:00:00.000+02:00", "2030-06-03T09:01:00.000Z"]) assert.equal((await fixture().publicSelection(startAt)).kind, "slot_invalid");
  for (const startAt of [selected, "2030-06-03T09:00:00Z", "2030-06-03T11:00:00.000+02:00"]) assertValid(await fixture().operatorSelection(startAt));
  assert.equal((await fixture().operatorSelection("2030-06-03T09:01:00.000Z")).kind, "slot_invalid");
});

async function loadAvailability() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-fresh-selection-range-")); const output = resolve(directory, "availability.mjs");
  try {
    await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: output, logLevel: "silent" });
    return await import(pathToFileURL(output).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
