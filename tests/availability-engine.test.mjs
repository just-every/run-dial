import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const engine = await loadEngine();

contract("AVAIL-006", "UTC slot arithmetic excludes DST gaps, preserves both folds, and refuses a skipped host date", () => {
  assert.equal(engine.wallClockInstants("2026-03-08", 150, "America/New_York").length, 0, "02:30 does not exist on the spring transition");
  const folded = engine.wallClockInstants("2026-11-01", 90, "America/New_York");
  assert.equal(folded.length, 2, "01:30 occurs twice on the autumn transition");
  assert.notEqual(engine.offsetMinutesForInstant(folded[0].toISOString(), "America/New_York"), engine.offsetMinutesForInstant(folded[1].toISOString(), "America/New_York"));
  assert.equal(engine.firstInstantOfHostDate("2011-12-30", "Pacific/Apia"), undefined, "the dateline-skipped local date is never fabricated as UTC midnight");
});

contract("AVAIL-002", "buffers, host-day caps, and busy intervals can only remove slots from a recurring host-zone schedule", () => {
  const base = {
    hostTimeZone: "UTC",
    recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
    overrides: [],
    constraints: { durationMinutes: 30, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 15, afterBufferMinutes: 15, hostDayBookingLimit: null },
    fromHostDate: "2030-06-03",
    days: 1,
    now: new Date("2030-01-01T00:00:00.000Z"),
  };
  const all = engine.listAvailableSlots({ ...base, internalClaims: [], calendarBusy: [] });
  assert.deepEqual(all.map((slot) => slot.startAt), ["2030-06-03T09:00:00.000Z", "2030-06-03T09:30:00.000Z", "2030-06-03T10:00:00.000Z", "2030-06-03T10:30:00.000Z"]);
  const busy = engine.listAvailableSlots({ ...base, internalClaims: [], calendarBusy: [{ startAt: "2030-06-03T09:30:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }] });
  assert.deepEqual(busy.map((slot) => slot.startAt), ["2030-06-03T10:30:00.000Z"], "both candidate buffers intersecting busy time are excluded");
  const capped = engine.listAvailableSlots({ ...base, constraints: { ...base.constraints, hostDayBookingLimit: 1 }, internalClaims: [{ startAt: "2030-06-03T09:00:00.000Z", endAt: "2030-06-03T09:30:00.000Z", hostDate: "2030-06-03" }], calendarBusy: [] });
  assert.equal(capped.length, 0, "a reached host-day limit removes every later candidate that day");
});

async function loadEngine() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-availability-engine-"));
  const output = resolve(directory, "engine.mjs");
  try {
    await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: output, logLevel: "silent" });
    return await import(pathToFileURL(output).href);
  } finally {
    // The imported ESM module has already been loaded before this temporary output is removed.
    await rm(directory, { recursive: true, force: true });
  }
}
