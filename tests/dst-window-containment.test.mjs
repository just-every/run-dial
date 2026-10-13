import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const engine = await loadEngine();
function input(changes = {}) {
  return {
    hostTimeZone: "UTC", recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 660 }], overrides: [],
    constraints: { durationMinutes: 90, slotIncrementMinutes: 15, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, ...changes.constraints },
    fromHostDate: "2030-06-03", days: 1, now: new Date("2030-01-01T00:00:00.000Z"), internalClaims: [], calendarBusy: [],
    ...Object.fromEntries(Object.entries(changes).filter(([key]) => key !== "constraints")),
  };
}
function transition(hostDate, startMinute, endMinute, durationMinutes) {
  return input({ hostTimeZone: "America/New_York", fromHostDate: hostDate, now: new Date("2026-01-01T00:00:00.000Z"), recurringWindows: [{ weekday: 0, startMinute, endMinute }], constraints: { durationMinutes } });
}
const starts = (source) => engine.listAvailableSlots(source).map((slot) => slot.startAt);
function evaluate(source, startAt, expectedWindow) {
  const start = new Date(startAt), end = new Date(start.getTime() + source.constraints.durationMinutes * 60_000);
  const parts = engine.zonedParts(start, source.hostTimeZone);
  return engine.evaluateSlot(source, engine.hostDateForInstant(startAt, source.hostTimeZone), parts.hour * 60 + parts.minute, start, end, source.now, expectedWindow);
}
function consistency(source, cases) {
  const offered = starts(source);
  for (const [startAt, valid] of cases) {
    assert.equal(evaluate(source, startAt).valid, valid, `direct evaluation of${startAt}`);
    assert.equal(offered.includes(startAt), valid, `offered status of${startAt}`);
  }
}

contract("AVAIL-002", "spring 01:30–03:30 cannot contain 120 actual UTC minutes", () => {
  const source = transition("2026-03-08", 90, 210, 120);
  assert.deepEqual(starts(source), []);
  consistency(source, [["2026-03-08T06:30:00.000Z", false], ["2026-03-08T06:45:00.000Z", false], ["2026-03-08T07:00:00.000Z", false]]);
  assert.equal(evaluate(source, "2026-03-08T06:30:00.000Z", { startMinute: 90, endMinute: 210 }).valid, false);
});

contract("AVAIL-006", "spring duration may end exactly at the actual 03:30 closing boundary", () => {
  const source = transition("2026-03-08", 90, 210, 60);
  const slots = engine.listAvailableSlots(source);
  assert.deepEqual(slots.map((slot) => [slot.startAt, slot.endAt]), [["2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z"]]);
  consistency(source, [["2026-03-08T06:30:00.000Z", true], ["2026-03-08T06:45:00.000Z", false], ["2026-03-08T07:00:00.000Z", false]]);
});

contract("AVAIL-006", "fall 01:00–02:00 admits 90 elapsed minutes only when the full UTC interval fits", () => {
  const source = transition("2026-11-01", 60, 120, 90);
  const slots = engine.listAvailableSlots(source);
  assert.deepEqual(slots.map((slot) => [slot.startAt, slot.endAt]), [
    ["2026-11-01T05:00:00.000Z", "2026-11-01T06:30:00.000Z"],
    ["2026-11-01T05:15:00.000Z", "2026-11-01T06:45:00.000Z"],
    ["2026-11-01T05:30:00.000Z", "2026-11-01T07:00:00.000Z"],
  ]);
  consistency(source, [["2026-11-01T05:00:00.000Z", true], ["2026-11-01T05:15:00.000Z", true], ["2026-11-01T05:30:00.000Z", true], ["2026-11-01T05:45:00.000Z", false], ["2026-11-01T06:00:00.000Z", false], ["2026-11-01T06:30:00.000Z", false]]);
});

contract("AVAIL-006", "narrow fall windows never bridge a closed first-fold period, even when endpoints have open wall labels", () => {
  const source = transition("2026-11-01", 90, 120, 45);
  assert.deepEqual(starts(source), []);
  consistency(source, [["2026-11-01T05:30:00.000Z", false], ["2026-11-01T05:45:00.000Z", false], ["2026-11-01T06:30:00.000Z", false]]);
  const before = engine.zonedParts(new Date("2026-11-01T05:45:00.000Z"), source.hostTimeZone);
  const after = engine.zonedParts(new Date("2026-11-01T06:30:00.000Z"), source.hostTimeZone);
  assert.equal(before.hour * 60 + before.minute, 105); assert.equal(after.hour * 60 + after.minute, 90);
});

contract("AVAIL-006", "exclusive fold-run ends are valid although the end instant itself has a closed wall label", () => {
  const source = transition("2026-11-01", 90, 120, 30);
  const slots = engine.listAvailableSlots(source);
  assert.deepEqual(slots.map((slot) => [slot.startAt, slot.endAt]), [["2026-11-01T05:30:00.000Z", "2026-11-01T06:00:00.000Z"], ["2026-11-01T06:30:00.000Z", "2026-11-01T07:00:00.000Z"]]);
  consistency(source, [["2026-11-01T05:30:00.000Z", true], ["2026-11-01T05:45:00.000Z", false], ["2026-11-01T06:30:00.000Z", true], ["2026-11-01T06:45:00.000Z", false]]);
  assert.notEqual(slots[0].hostOffset, slots[1].hostOffset);
});

contract("AVAIL-002", "adjacent and overlapping original windows cannot be merged to admit a longer duration", () => {
  for (const recurringWindows of [
    [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 600, endMinute: 660 }],
    [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 570, endMinute: 630 }],
  ]) {
    const source = input({ recurringWindows }); assert.deepEqual(starts(source), []);
    consistency(source, [["2030-06-03T09:00:00.000Z", false], ["2030-06-03T09:15:00.000Z", false], ["2030-06-03T09:30:00.000Z", false]]);
  }
  const short = input({ constraints: { durationMinutes: 60 }, recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 600, endMinute: 660 }] });
  assert.deepEqual(starts(short), ["2030-06-03T09:00:00.000Z", "2030-06-03T10:00:00.000Z"]);
});

contract("AVAIL-002", "replacement and closed overrides govern containment rather than contributing recurrence spans", () => {
  const original = input(); assert.deepEqual(starts(original), ["2030-06-03T09:00:00.000Z", "2030-06-03T09:15:00.000Z", "2030-06-03T09:30:00.000Z"]);
  for (const override of [{ hostDate: "2030-06-03", mode: "open", windows: [{ startMinute: 540, endMinute: 600 }, { startMinute: 600, endMinute: 660 }] }, { hostDate: "2030-06-03", mode: "closed", windows: [] }]) {
    const source = input({ overrides: [override] }); assert.deepEqual(starts(source), []);
    consistency(source, [["2030-06-03T09:00:00.000Z", false], ["2030-06-03T09:30:00.000Z", false]]);
    assert.equal(evaluate(source, "2030-06-03T09:00:00.000Z", { startMinute: 540, endMinute: 660 }).valid, false, "stale recurrence window does not bypass an override");
  }
});

contract("AVAIL-002", "exact schedule and busy boundaries stay exclusive without requiring buffers inside the open window", () => {
  const source = input({ constraints: { durationMinutes: 60, beforeBufferMinutes: 15, afterBufferMinutes: 15 }, recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 600 }], calendarBusy: [{ startAt: "2030-06-03T08:30:00.000Z", endAt: "2030-06-03T08:45:00.000Z" }, { startAt: "2030-06-03T10:15:00.000Z", endAt: "2030-06-03T10:30:00.000Z" }] });
  assert.deepEqual(engine.listAvailableSlots(source).map((slot) => [slot.startAt, slot.endAt]), [["2030-06-03T09:00:00.000Z", "2030-06-03T10:00:00.000Z"]]);
  consistency(source, [["2030-06-03T09:00:00.000Z", true], ["2030-06-03T09:15:00.000Z", false]]);
  const blocked = { ...source, calendarBusy: [{ startAt: "2030-06-03T08:30:00.000Z", endAt: "2030-06-03T08:46:00.000Z" }] };
  assert.deepEqual(starts(blocked), []); assert.equal(evaluate(blocked, "2030-06-03T09:00:00.000Z").valid, false);
});

contract("AVAIL-006", "the date preceding Apia's skipped day retains its exclusive next actual midnight boundary", () => {
  const source = input({ hostTimeZone: "Pacific/Apia", fromHostDate: "2011-12-29", now: new Date("2011-12-01T00:00:00.000Z"), constraints: { durationMinutes: 60 }, recurringWindows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 1380, endMinute: 1440 })) });
  const slots = engine.listAvailableSlots(source);
  assert.deepEqual(slots.map((slot) => [slot.startAt, slot.endAt, slot.hostDate]), [["2011-12-30T09:00:00.000Z", "2011-12-30T10:00:00.000Z", "2011-12-29"]]);
  const end = engine.zonedParts(new Date(slots[0].endAt), source.hostTimeZone);
  assert.deepEqual([end.year, end.month, end.day, end.hour, end.minute], [2011, 12, 31, 0, 0]);
  consistency(source, [["2011-12-30T09:00:00.000Z", true], ["2011-12-30T09:15:00.000Z", false]]);
  assert.deepEqual(starts({ ...source, fromHostDate: "2011-12-30" }), [], "the skipped civil day is never fabricated");
});

async function loadEngine() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-dst-window-containment-")); const output = resolve(directory, "engine.mjs");
  try {
    await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: output, logLevel: "silent" });
    return await import(pathToFileURL(output).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
