import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const engine = await loadEngine();
function input(zone, hostDate, startMinute, endMinute, changes = {}) {
  const year = hostDate.slice(0, 4);
  return {
    hostTimeZone: zone, recurringWindows: [{ weekday: weekday(hostDate), startMinute, endMinute }], overrides: [],
    constraints: { durationMinutes: 10, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, ...changes.constraints },
    fromHostDate: hostDate, days: 1, now: new Date(`${year}-01-01T00:00:00.000Z`), internalClaims: [], calendarBusy: [],
    ...Object.fromEntries(Object.entries(changes).filter(([key]) => key !== "constraints")),
  };
}
function dayPlus(hostDate, days) { const date = new Date(hostDate + "T00:00:00.000Z"); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function weekday(hostDate) { return new Date(hostDate + "T00:00:00.000Z").getUTCDay(); }

/** Independent wall-clock enumeration; no optimized UTC timeline or window-span helper is used. */
function canonicalSlots(source) {
  const slots = [];
  for (let day = 0; day < source.days; day++) {
    const hostDate = dayPlus(source.fromHostDate, day);
    const override = source.overrides.find((entry) => entry.hostDate === hostDate);
    const windows = override ? override.mode === "closed" ? [] : override.windows : source.recurringWindows.filter((window) => window.weekday === weekday(hostDate));
    for (const window of windows) {
      for (let hostMinute = window.startMinute; hostMinute < window.endMinute; hostMinute += source.constraints.slotIncrementMinutes) {
        for (const start of engine.wallClockInstants(hostDate, hostMinute, source.hostTimeZone)) {
          const end = new Date(start.getTime() + source.constraints.durationMinutes * 60_000);
          if (engine.evaluateSlot(source, hostDate, hostMinute, start, end, source.now, window).valid) {
            slots.push({ startAt: start.toISOString(), endAt: end.toISOString(), hostDate, hostOffset: engine.zonedOffsetLabel(start, source.hostTimeZone) });
          }
        }
      }
    }
  }
  const unique = new Map();
  for (const slot of slots) unique.set(slot.startAt, slot);
  return [...unique.values()].sort((left, right) => left.startAt.localeCompare(right.startAt));
}
function equivalent(source, expectedStarts) {
  const unchanged = JSON.stringify(source);
  const canonical = canonicalSlots(source);
  const optimized = engine.listAvailableSlots(source);
  assert.deepEqual(optimized, canonical, "optimized enumeration must preserve every canonical full slot DTO");
  assert.deepEqual(optimized.map((slot) => slot.startAt), expectedStarts);
  assert.equal(JSON.stringify(source), unchanged, "enumeration must not mutate schedule, constraints or occupancy");
  for (const slot of optimized) {
    assert.deepEqual(Object.keys(slot).sort(), ["endAt", "hostDate", "hostOffset", "startAt"]);
    assert.equal(Date.parse(slot.endAt) - Date.parse(slot.startAt), source.constraints.durationMinutes * 60_000);
  }
  return optimized;
}

contract("AVAIL-006", "Lord Howe's 30-minute fold preserves both non-hour anchored starts at a 60-minute wall increment", () => {
  const source = input("Australia/Lord_Howe", "2026-04-05", 100, 190);
  const repeated = engine.wallClockInstants(source.fromHostDate, 100, source.hostTimeZone);
  assert.equal(repeated.length, 2); assert.equal(repeated[1].getTime() - repeated[0].getTime(), 30 * 60_000);
  const slots = equivalent(source, ["2026-04-04T14:40:00.000Z", "2026-04-04T15:10:00.000Z", "2026-04-04T16:10:00.000Z"]);
  assert.notEqual(slots[0].hostOffset, slots[1].hostOffset);
});

contract("AVAIL-006", "Lord Howe's 30-minute gap preserves the original wall increment even when its anchor is absent", () => {
  equivalent(input("Australia/Lord_Howe", "2026-10-04", 100, 190), ["2026-10-03T15:10:00.000Z", "2026-10-03T15:40:00.000Z"]);
  const missingAnchor = input("Australia/Lord_Howe", "2026-10-04", 130, 200);
  assert.deepEqual(engine.wallClockInstants(missingAnchor.fromHostDate, 130, missingAnchor.hostTimeZone), []);
  equivalent(missingAnchor, ["2026-10-03T16:10:00.000Z"]);
});

contract("AVAIL-006", "New York folds and gaps preserve canonical window-local increments and full DTOs", () => {
  equivalent(input("America/New_York", "2026-11-01", 70, 140), ["2026-11-01T05:10:00.000Z", "2026-11-01T06:10:00.000Z", "2026-11-01T07:10:00.000Z"]);
  equivalent(input("America/New_York", "2026-03-08", 130, 200), ["2026-03-08T07:10:00.000Z"]);
});

contract("AVAIL-002", "Kathmandu's non-hour UTC offset and replacement overrides preserve the window anchor", () => {
  const source = input("Asia/Kathmandu", "2030-06-03", 550, 675, { constraints: { durationMinutes: 20 } });
  equivalent(source, ["2030-06-03T03:25:00.000Z", "2030-06-03T04:25:00.000Z"]);
  const replaced = { ...source, constraints: { ...source.constraints, durationMinutes: 15 }, overrides: [{ hostDate: source.fromHostDate, mode: "open", windows: [{ startMinute: 605, endMinute: 680 }] }] };
  equivalent(replaced, ["2030-06-03T04:20:00.000Z", "2030-06-03T05:20:00.000Z"]);
  equivalent({ ...source, overrides: [{ hostDate: source.fromHostDate, mode: "closed", windows: [] }] }, []);
});

contract("AVAIL-002", "adjacent and overlapping windows keep their own anchors and deduplicate shared starts", () => {
  const adjacent = input("UTC", "2030-06-03", 550, 610, { constraints: { durationMinutes: 30 }, recurringWindows: [{ weekday: 1, startMinute: 550, endMinute: 610 }, { weekday: 1, startMinute: 610, endMinute: 670 }] });
  equivalent(adjacent, ["2030-06-03T09:10:00.000Z", "2030-06-03T10:10:00.000Z"]);
  const overlapping = { ...adjacent, constraints: { ...adjacent.constraints, durationMinutes: 15, slotIncrementMinutes: 30 }, recurringWindows: [{ weekday: 1, startMinute: 550, endMinute: 610 }, { weekday: 1, startMinute: 580, endMinute: 640 }] };
  equivalent(overlapping, ["2030-06-03T09:10:00.000Z", "2030-06-03T09:40:00.000Z", "2030-06-03T10:10:00.000Z"]);
  equivalent({ ...adjacent, constraints: { ...adjacent.constraints, durationMinutes: 90 } }, []);
});

contract("AVAIL-006", "Apia's skipped date and preceding midnight preserve canonical enumeration", () => {
  const source = input("Pacific/Apia", "2011-12-29", 1380, 1440, { days: 2, constraints: { durationMinutes: 60 }, recurringWindows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 1380, endMinute: 1440 })) });
  const slots = equivalent(source, ["2011-12-30T09:00:00.000Z"]);
  assert.deepEqual([slots[0].endAt, slots[0].hostDate], ["2011-12-30T10:00:00.000Z", "2011-12-29"]);
  equivalent({ ...source, fromHostDate: "2011-12-30", days: 1 }, []);
});

contract("AVAIL-006", "Goose Bay's midnight rollback retains both preceding-date final hours", () => {
  const source = input("America/Goose_Bay", "1988-10-29", 1380, 1440, { constraints: { durationMinutes: 60 } });
  assert.deepEqual(engine.wallClockInstants(source.fromHostDate, 1380, source.hostTimeZone).map((start) => start.toISOString()), ["1988-10-30T01:00:00.000Z", "1988-10-30T03:00:00.000Z"]);
  const slots = equivalent(source, ["1988-10-30T01:00:00.000Z", "1988-10-30T03:00:00.000Z"]);
  assert.deepEqual(slots.map((slot) => slot.endAt), ["1988-10-30T02:00:00.000Z", "1988-10-30T04:00:00.000Z"]);
});

contract("AVAIL-006", "Goose Bay's next-date early window cannot span the rollback into the previous date", () => {
  const source = input("America/Goose_Bay", "1988-10-30", 0, 60, { constraints: { durationMinutes: 60 } });
  assert.deepEqual(engine.wallClockInstants(source.fromHostDate, 0, source.hostTimeZone).map((start) => start.toISOString()), ["1988-10-30T02:00:00.000Z", "1988-10-30T04:00:00.000Z"]);
  const slots = equivalent(source, ["1988-10-30T04:00:00.000Z"]);
  assert.equal(slots[0].endAt, "1988-10-30T05:00:00.000Z");
});

contract("AVAIL-003", "a week ending before Goose Bay's midnight rollback reads busy claims through the last repeated midnight", async () => {
  const source = input("America/Goose_Bay", "1988-10-29", 1380, 1440, { constraints: { durationMinutes: 30, slotIncrementMinutes: 30 } });
  const event = { id: "synthetic-goose-bay", availability: source.recurringWindows, ...source.constraints };
  const calendarReads = []; const claimReads = [];
  const service = new engine.AvailabilityService(
    { async listOwnCalendarEvents() { return []; }, async listInternalClaims(...range) { claimReads.push(range); return []; } },
    { async getPublicProfile() { return { timezone: source.hostTimeZone }; } },
    { async resolvePublishedEventForPublicRequest() { return event; }, async listDateAvailabilityOverrides() { return []; } },
    { async readBusy(range) { calendarReads.push(range); return { kind: "ok", intervals: [{ startAt: "1988-10-30T03:00:00.000Z", endAt: "1988-10-30T03:30:00.000Z" }] }; } },
  );
  const result = await service.listPublicWeek("synthetic-host", "synthetic-event", "1988-10-23", undefined, new Date("1988-10-01T00:00:00.000Z"));
  assert.equal(result.state, "available");
  assert.deepEqual(calendarReads, [{ startAt: "1988-10-23T02:00:00.000Z", endAt: "1988-10-30T04:00:00.000Z", freshness: "cached" }]);
  assert.deepEqual(claimReads, [["1988-10-23T02:00:00.000Z", "1988-10-30T04:00:00.000Z", undefined, []]]);
  assert.deepEqual(result.slots, canonicalSlots({ ...source, calendarBusy: [{ startAt: "1988-10-30T03:00:00.000Z", endAt: "1988-10-30T03:30:00.000Z" }] }));
  assert.deepEqual(result.slots.map((slot) => slot.startAt), ["1988-10-30T01:00:00.000Z", "1988-10-30T01:30:00.000Z", "1988-10-30T03:30:00.000Z"]);
});

async function loadEngine() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-availability-enumeration-")); const output = resolve(directory, "engine.mjs");
  try {
    await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: output, logLevel: "silent" });
    return await import(pathToFileURL(output).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
