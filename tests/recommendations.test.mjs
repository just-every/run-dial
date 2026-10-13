import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance as benchmarkClock } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const availability = await loadAvailability();
const minute = 60_000;
const instant = (value) => Date.parse(value);
const range = (start, end) => ({ start: instant(start), end: instant(end) });
const intervalMinutes = (intervals) => intervals.map(({ start, end }) => (end - start) / minute);
const starts = (slots) => slots.map((slot) => slot.startAt);
function input(changes = {}) {
  return {
    hostTimeZone: "UTC", recurringWindows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })), overrides: [],
    constraints: { durationMinutes: 30, slotIncrementMinutes: 15, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, ...changes.constraints },
    fromHostDate: "2030-06-03", days: 1, now: new Date("2030-01-01T00:00:00.000Z"), internalClaims: [], calendarBusy: [],
    ...Object.fromEntries(Object.entries(changes).filter(([key]) => key !== "constraints")),
  };
}
function slot(startAt, endAt, zone = "UTC") {
  return { startAt, endAt, hostDate: availability.hostDateForInstant(startAt, zone), hostOffset: availability.zonedOffsetLabel(new Date(startAt), zone) };
}
const monday = range("2030-06-03T00:00:00.000Z", "2030-06-04T00:00:00.000Z");

contract("AVAIL-007", "whole 09–17 intervals include the exact end, exclude crossings, and apply on published weekends", () => {
  const context = availability.buildRecommendationContext(input(), monday);
  assert.deepEqual(context.working, [range("2030-06-03T09:00:00.000Z", "2030-06-03T17:00:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.working), [480]);
  const offers = [
    slot("2030-06-03T08:30:00.000Z", "2030-06-03T09:00:00.000Z"),
    slot("2030-06-03T09:00:00.000Z", "2030-06-03T09:30:00.000Z"),
    slot("2030-06-03T16:30:00.000Z", "2030-06-03T17:00:00.000Z"),
    slot("2030-06-03T16:45:00.000Z", "2030-06-03T17:15:00.000Z"),
    slot("2030-06-03T17:00:00.000Z", "2030-06-03T17:30:00.000Z"),
  ];
  const ranked = availability.rankSlots(offers, context);
  assert.deepEqual(starts(ranked), [offers[1].startAt, offers[2].startAt, offers[0].startAt, offers[3].startAt, offers[4].startAt]);
  assert.ok(ranked.slice(0, 2).every((entry) => entry.reason === "Inside host working day"));
  assert.ok(ranked.slice(2).every((entry) => entry.reason !== "Inside host working day"));
  const saturdayRange = range("2030-06-08T00:00:00.000Z", "2030-06-09T00:00:00.000Z");
  const saturday = availability.buildRecommendationContext(input({ fromHostDate: "2030-06-08", constraints: { durationMinutes: 480 } }), saturdayRange);
  assert.deepEqual(intervalMinutes(saturday.working), [480]);
  assert.equal(availability.rankSlots([slot("2030-06-08T09:00:00.000Z", "2030-06-08T17:00:00.000Z")], saturday)[0].reason, "Inside host working day");
  assert.notEqual(availability.rankSlots([slot("2030-06-03T16:30:00.001Z", "2030-06-03T17:00:00.001Z")], context)[0].reason, "Inside host working day");
});

contract("AVAIL-007", "business-hour precedence beats a larger continuous free component", () => {
  const context = availability.buildRecommendationContext(input({ recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 1080, endMinute: 1380 }] }), monday);
  assert.deepEqual(intervalMinutes(context.free), [60, 300]);
  const early = slot("2030-06-03T09:00:00.000Z", "2030-06-03T09:30:00.000Z");
  const later = slot("2030-06-03T20:00:00.000Z", "2030-06-03T20:30:00.000Z");
  assert.equal((context.free[0].end - context.free[0].start) / minute - 30, 30);
  assert.equal((context.free[1].end - context.free[1].start) / minute - 30, 270);
  assert.deepEqual(starts(availability.rankSlots([later, early], context)), [early.startAt, later.startAt]);
});

contract("AVAIL-007", "equal offered-slot counts still use continuous free minutes before the UTC tie-break", () => {
  const source = input({ recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 660, endMinute: 720 }, { weekday: 1, startMinute: 840, endMinute: 900 }], constraints: { slotIncrementMinutes: 60 }, calendarBusy: [{ startAt: "2030-06-03T09:45:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }] });
  const offers = availability.listAvailableSlots(source);
  assert.deepEqual(starts(offers), ["2030-06-03T09:00:00.000Z", "2030-06-03T11:00:00.000Z", "2030-06-03T14:00:00.000Z"], "one valid offered start in each open component");
  const context = availability.buildRecommendationContext(source, monday);
  assert.deepEqual(intervalMinutes(context.free), [45, 60, 60]);
  assert.deepEqual(intervalMinutes(context.free).map((minutes) => minutes - 30), [15, 30, 30]);
  assert.deepEqual(starts(availability.rankSlots([...offers].reverse(), context)), [offers[1].startAt, offers[2].startAt, offers[0].startAt]);
});

contract("AVAIL-007", "overlapping busy intervals and already-buffered claims merge once without inflating buffers", () => {
  const source = input({ recurringWindows: [{ weekday: 1, startMinute: 540, endMinute: 720 }], constraints: { beforeBufferMinutes: 15, afterBufferMinutes: 15 },
    calendarBusy: [{ startAt: "2030-06-03T10:40:00.000Z", endAt: "2030-06-03T10:45:00.000Z" }, { startAt: "2030-06-03T09:45:00.000Z", endAt: "2030-06-03T10:15:00.000Z" }, { startAt: "2030-06-03T09:30:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }, { startAt: "2030-06-03T09:30:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }],
    internalClaims: [{ startAt: "2030-06-03T09:40:00.000Z", endAt: "2030-06-03T10:40:00.000Z", hostDate: "2030-06-03" }],
  });
  const before = JSON.stringify(source);
  const context = availability.buildRecommendationContext(source, monday);
  assert.deepEqual(context.free, [range("2030-06-03T09:00:00.000Z", "2030-06-03T09:30:00.000Z"), range("2030-06-03T10:45:00.000Z", "2030-06-03T12:00:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.free), [30, 75]);
  assert.equal((context.free[1].end - context.free[1].start) / minute - 30, 45, "candidate buffers remain free context instead of being subtracted twice");
  const offers = availability.listAvailableSlots(source);
  assert.ok(offers.some((entry) => entry.startAt === "2030-06-03T11:00:00.000Z"), "a candidate buffer may abut the merged blocker exactly");
  assert.deepEqual(starts(availability.rankSlots(offers, context)), starts(offers));
  assert.deepEqual(availability.buildRecommendationContext({ ...source, calendarBusy: [...source.calendarBusy].reverse() }, monday), context);
  assert.equal(JSON.stringify(source), before);
});

contract("AVAIL-007", "closed and replacement overrides replace recurrence in both offers and free context", () => {
  const source = input({ recurringWindows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })), days: 2,
    overrides: [{ hostDate: "2030-06-03", mode: "closed", windows: [] }, { hostDate: "2030-06-04", mode: "open", windows: [{ startMinute: 780, endMinute: 840 }] }],
  });
  const context = availability.buildRecommendationContext(source, range("2030-06-03T00:00:00.000Z", "2030-06-05T00:00:00.000Z"));
  assert.deepEqual(context.free, [range("2030-06-04T13:00:00.000Z", "2030-06-04T14:00:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.free), [60]);
  const offers = availability.listAvailableSlots(source);
  assert.deepEqual(starts(offers), ["2030-06-04T13:00:00.000Z", "2030-06-04T13:15:00.000Z", "2030-06-04T13:30:00.000Z"]);
  assert.deepEqual(starts(availability.rankSlots(offers, context)), starts(offers));
});

contract("AVAIL-007", "DST gaps add no fictitious free minutes and narrow folded windows remain separate open runs", () => {
  const spring = input({ hostTimeZone: "America/New_York", fromHostDate: "2026-03-08", now: new Date("2026-01-01T00:00:00.000Z"), recurringWindows: [{ weekday: 0, startMinute: 135, endMinute: 165 }] });
  const springRange = range("2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z");
  assert.equal((springRange.end - springRange.start) / minute, 1380);
  assert.deepEqual(availability.buildRecommendationContext(spring, springRange).free, []);
  assert.deepEqual(availability.listAvailableSlots(spring), []);
  const fold = input({ hostTimeZone: "America/New_York", fromHostDate: "2026-11-01", now: new Date("2026-01-01T00:00:00.000Z"), constraints: { durationMinutes: 15 }, recurringWindows: [{ weekday: 0, startMinute: 75, endMinute: 105 }] });
  const foldRange = range("2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z");
  assert.equal((foldRange.end - foldRange.start) / minute, 1500);
  const context = availability.buildRecommendationContext(fold, foldRange);
  assert.deepEqual(context.free, [range("2026-11-01T05:15:00.000Z", "2026-11-01T05:45:00.000Z"), range("2026-11-01T06:15:00.000Z", "2026-11-01T06:45:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.free), [30, 30]);
  const offers = availability.listAvailableSlots(fold);
  assert.deepEqual(starts(offers), ["2026-11-01T05:15:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-01T06:15:00.000Z", "2026-11-01T06:30:00.000Z"]);
  assert.deepEqual(starts(availability.rankSlots([...offers].reverse(), context)), starts(offers));
  assert.notEqual(offers[0].hostOffset, offers[2].hostOffset);
});

contract("AVAIL-007", "non-hour invitee offsets use full intervals and include an exact local 17:00 end", () => {
  const context = availability.buildRecommendationContext(input(), monday, "Asia/Kathmandu");
  assert.deepEqual(context.working, [range("2030-06-03T09:00:00.000Z", "2030-06-03T11:15:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.working), [135]);
  const offers = [slot("2030-06-03T11:00:00.000Z", "2030-06-03T11:30:00.000Z"), slot("2030-06-03T10:45:00.000Z", "2030-06-03T11:15:00.000Z")];
  const ranked = availability.rankSlots(offers, context);
  assert.deepEqual(starts(ranked), [offers[1].startAt, offers[0].startAt]);
  assert.equal(ranked[0].reason, "Inside both working days"); assert.notEqual(ranked[1].reason, "Inside both working days");
});

contract("AVAIL-007", "initial host-only ranking and explicit invitee-zone ranking reorder identical immutable offers", () => {
  const offers = [slot("2030-06-03T10:00:00.000Z", "2030-06-03T10:30:00.000Z"), slot("2030-06-03T14:00:00.000Z", "2030-06-03T14:30:00.000Z")];
  const before = JSON.stringify(offers);
  const host = availability.buildRecommendationContext(input(), monday);
  const invitee = availability.buildRecommendationContext(input(), monday, "America/New_York");
  assert.equal(host.inviteeZoneSubmitted, false); assert.equal(invitee.inviteeZoneSubmitted, true);
  assert.deepEqual(intervalMinutes(host.working), [480]); assert.deepEqual(intervalMinutes(invitee.working), [240]);
  assert.deepEqual(starts(availability.rankSlots(offers, host)), starts(offers));
  assert.deepEqual(starts(availability.rankSlots(offers, invitee)), [offers[1].startAt, offers[0].startAt]);
  assert.equal(availability.rankSlots(offers, host)[0].reason, "Inside host working day");
  assert.equal(availability.rankSlots(offers, invitee)[0].reason, "Inside both working days");
  assert.equal(JSON.stringify(offers), before);
});

contract("AVAIL-007", "recommendations are deterministic, unique, capped at five, and expose only existing slot fields plus reason", () => {
  const source = input(); const offers = availability.listAvailableSlots(source).filter((entry) => entry.startAt >= "2030-06-03T09:00:00.000Z" && entry.startAt < "2030-06-03T12:00:00.000Z");
  assert.equal(offers.length, 12);
  const context = availability.buildRecommendationContext(source, monday);
  const supplied = Object.freeze([...offers].reverse().concat(offers[0]).map((entry) => Object.freeze({ ...entry })));
  const ranked = availability.rankSlots(supplied, context);
  assert.equal(ranked.length, 5); assert.equal(new Set(starts(ranked)).size, 5);
  assert.deepEqual(starts(ranked), starts(offers.slice(0, 5)));
  assert.deepEqual(availability.rankSlots(supplied, context), ranked);
  for (const entry of ranked) {
    assert.deepEqual(Object.keys(entry).sort(), ["endAt", "hostDate", "hostOffset", "reason", "startAt"]);
    const { reason, ...existing } = entry; assert.ok(reason); assert.ok(offers.some((offer) => JSON.stringify(offer) === JSON.stringify(existing)));
  }
});

contract("AVAIL-007", "a supplied legacy DST overshoot has zero free context and remains a ranked input rather than widening or filtering offers", () => {
  const source = input({ hostTimeZone: "America/New_York", fromHostDate: "2026-03-08", now: new Date("2026-01-01T00:00:00.000Z"), constraints: { durationMinutes: 120 }, recurringWindows: [{ weekday: 0, startMinute: 90, endMinute: 210 }] });
  const context = availability.buildRecommendationContext(source, range("2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"));
  assert.deepEqual(context.free, [range("2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z")]);
  assert.deepEqual(intervalMinutes(context.free), [60]);
  const knownInput = slot("2026-03-08T06:30:00.000Z", "2026-03-08T08:30:00.000Z", "America/New_York");
  assert.deepEqual(availability.rankSlots([knownInput], context), [{ ...knownInput, reason: "Earliest available time" }]);
  // This checks the ranking boundary, not a claim that this supplied legacy candidate satisfies AVAIL-002.
});

contract("AVAIL-007", "seven-day host-only and two-zone context builds report their bounded pure-computation cost", () => {
  const source = input({ days: 7 }); const week = range("2030-06-03T00:00:00.000Z", "2030-06-10T00:00:00.000Z");
  const costs = {};
  for (const [name, zone] of [["hostOnly", undefined], ["twoZones", "America/New_York"]]) {
    const started = benchmarkClock.now(); const context = availability.buildRecommendationContext(source, week, zone);
    costs[name] = Math.round((benchmarkClock.now() - started) * 100) / 100;
    assert.equal(context.working.length, 7); assert.deepEqual(intervalMinutes(context.working), Array(7).fill(zone ? 240 : 480));
  }
  console.log(`Recommendation seven-day context benchmark (ms): ${JSON.stringify(costs)}`);
});

async function loadAvailability() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-recommendations-"));
  const output = resolve(directory, "availability.mjs");
  try {
    await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: output, logLevel: "silent" });
    return await import(pathToFileURL(output).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

contract("AVAIL-007", "full ranking preserves every valid offer and the capped recommendations are its exact prefix", () => {
  const source = input();
  const offers = availability.listAvailableSlots(source);
  const context = availability.buildRecommendationContext(source, monday, "America/New_York");
  const ranked = availability.rankSlots([...offers].reverse(), context, offers.length);
  assert.equal(ranked.length, offers.length);
  assert.deepEqual(starts(ranked).sort(), starts(offers).sort());
  assert.deepEqual(availability.rankSlots(offers, context), availability.rankSlots(offers, context, offers.length).slice(0, 5));
  assert.deepEqual(availability.rankSlots([...offers].reverse(), context, offers.length), availability.rankSlots(offers, context, offers.length));
  assert.ok(ranked.every(slot => slot.reason));
});
