import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const core = await loadCore();
const now = new Date("2030-06-01T00:00:00.000Z"), selected = "2030-06-03T09:00:00.000Z";
function fixture(changes = {}) {
  const profile = { timezone: changes.zone ?? "UTC" };
  const event = { id: "synthetic-event", durationMinutes: 30, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 15, afterBufferMinutes: 20, hostDayBookingLimit: null,
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 720 })), ...changes.event };
  const reads = [], claimReads = [];
  const service = new core.AvailabilityService(
    { async listOwnCalendarEvents() { return []; }, async listInternalClaims(startAt, endAt, excluded, dates) { claimReads.push({ startAt, endAt, excluded, dates }); return (changes.claims ?? []).filter((claim) => claim.id !== excluded && ((Date.parse(claim.startAt) < Date.parse(endAt) && Date.parse(claim.endAt) > Date.parse(startAt)) || dates.includes(claim.hostDate))); } },
    { async getProfile() { return profile; }, async getPublicProfile() { return profile; } },
    { async getEventType() { return changes.missing ? undefined : event; }, async resolvePublishedEventForPublicRequest() { return event; }, async listDateAvailabilityOverrides() { return changes.overrideFailure ? undefined : changes.overrides ?? []; } },
    { async readBusy(input) { reads.push(input); return changes.providerFailure ? { kind: "unavailable", code: "synthetic_private_failure" } : { kind: "ok", intervals: changes.busy ?? [] }; } },
  );
  return { service, reads, claimReads,
    diagnose: (start = selected, options = { overrideNoticeAndHorizon: false }, at = now) => service.diagnoseOperatorTime(event.id, start, options, at),
    verify: (start = selected, options = { overrideNoticeAndHorizon: false }, at = now, excluded) => service.verifyOperatorSelection(event.id, start, options, at, excluded),
    publicWeek: (day = "2030-06-03", at = now) => service.listPublicWeek("synthetic-host", "synthetic-event", day, undefined, at),
  };
}
async function rules(proof, start = selected, options) {
  const result = await proof.diagnose(start, options); assert.equal(result.kind, "evaluated");
  assert.equal(result.diagnosis.valid, result.diagnosis.exclusions.length === 0);
  assert.deepEqual(Object.keys(result.diagnosis).sort(), ["endAt", "exclusions", "hostDate", "hostTimezone", "startAt", "valid"]);
  return result.diagnosis.exclusions;
}
contract("AVAIL-009", "diagnostics name schedule, increment, notice and horizon from exactly one fresh bounded read", async () => {
  for (const [changes, start, expected] of [[{}, "2030-06-03T08:00:00.000Z", ["schedule"]], [{}, "2030-06-03T09:05:00.000Z", ["start_increment"]], [{ event: { minimumNoticeMinutes: 7 * 1440 } }, selected, ["minimum_notice"]], [{ event: { bookingHorizonDays: 1 } }, selected, ["horizon"]]]) {
    const proof = fixture(changes); assert.deepEqual(await rules(proof, start), expected);
    assert.deepEqual(proof.reads, [{ startAt: "2030-06-02T23:45:00.000Z", endAt: "2030-06-04T00:20:00.000Z", freshness: "fresh" }]); assert.deepEqual(proof.claimReads[0].dates, []);
    const failure = await proof.verify(start); assert.equal(failure.kind, "slot_invalid"); assert.deepEqual(failure.exclusions, expected);
  }
});
contract("AVAIL-009", "closed and replacing open overrides identify their date rule without duplicate schedule labels", async () => {
  for (const override of [{ hostDate: "2030-06-03", mode: "closed", windows: [] }, { hostDate: "2030-06-03", mode: "open", windows: [{ startMinute: 600, endMinute: 660 }] }]) assert.deepEqual(await rules(fixture({ overrides: [override] })), ["date_override"]);
  assert.deepEqual(await rules(fixture({ event: { durationMinutes: 90 }, overrides: [{ hostDate: "2030-06-03", mode: "open", windows: [{ startMinute: 540, endMinute: 600 }] }] })), ["date_override"]);
});
contract("AVAIL-009", "buffer-only busy exclusions differ from direct overlap and preserve exact half-open boundaries", async () => {
  for (const busy of [{ startAt: "2030-06-03T08:44:00.000Z", endAt: "2030-06-03T08:46:00.000Z" }, { startAt: "2030-06-03T09:49:00.000Z", endAt: "2030-06-03T09:51:00.000Z" }]) assert.deepEqual(await rules(fixture({ busy: [busy] })), ["calendar_busy", "buffer"]);
  for (const busy of [{ startAt: "2030-06-03T08:00:00.000Z", endAt: "2030-06-03T08:45:00.000Z" }, { startAt: "2030-06-03T09:50:00.000Z", endAt: "2030-06-03T10:00:00.000Z" }]) assert.deepEqual(await rules(fixture({ busy: [busy] })), []);
  assert.deepEqual(await rules(fixture({ busy: [{ startAt: "2030-06-03T09:15:00.000Z", endAt: "2030-06-03T09:20:00.000Z" }] })), ["calendar_busy"]);
});
contract("AVAIL-009", "claim buffers use actual occurrences while persisted host-date caps and owned exclusions remain separate", async () => {
  const claim = { id: "private-booking-id", hostDate: "2030-06-03", startAt: "2030-06-03T09:15:00.000Z", endAt: "2030-06-03T10:15:00.000Z", bookingStartAt: "2030-06-03T09:30:00.000Z", bookingEndAt: "2030-06-03T10:00:00.000Z" };
  assert.deepEqual(await rules(fixture({ claims: [claim] })), ["dial_booking", "buffer"]);
  assert.deepEqual(await rules(fixture({ claims: [{ ...claim, bookingStartAt: "2030-06-03T09:20:00.000Z" }] })), ["dial_booking"]);
  const priorBuffer = { ...claim, startAt: "2030-06-03T08:00:00.000Z", endAt: "2030-06-03T09:01:00.000Z", bookingStartAt: "2030-06-03T08:00:00.000Z", bookingEndAt: "2030-06-03T08:30:00.000Z" };
  assert.deepEqual(await rules(fixture({ claims: [priorBuffer], event: { beforeBufferMinutes: 0, afterBufferMinutes: 0 } })), ["dial_booking", "buffer"]);
  const proof = fixture({ event: { hostDayBookingLimit: 1 }, claims: [{ ...claim, startAt: "2030-06-04T01:00:00.000Z", endAt: "2030-06-04T02:00:00.000Z" }] });
  assert.deepEqual(await rules(proof), ["host_day_limit"]); assert.deepEqual(proof.claimReads[0].dates, ["2030-06-03"]);
  assert.equal((await fixture({ claims: [claim], event: { hostDayBookingLimit: 1 } }).verify(selected, undefined, now, claim.id)).kind, "valid");
});
contract("AVAIL-009", "operator overrides remove only declared rules and failed reads never invent a diagnosis", async () => {
  const notice = fixture({ event: { minimumNoticeMinutes: 7 * 1440, bookingHorizonDays: 1 } }); assert.deepEqual(await rules(notice), ["minimum_notice", "horizon"]); assert.deepEqual(await rules(notice, selected, { overrideNoticeAndHorizon: true }), []);
  assert.deepEqual(await rules(fixture({ busy: [{ startAt: selected, endAt: "2030-06-03T09:30:00.000Z" }] }), selected, { overrideNoticeAndHorizon: true }), ["calendar_busy"]);
  for (const changes of [{ providerFailure: true }, { overrideFailure: true }]) assert.equal((await fixture(changes).diagnose()).kind, "calendar_unavailable");
  const missing = fixture({ missing: true }); assert.equal((await missing.diagnose()).kind, "not_found"); assert.equal(missing.reads.length, 0);
});
contract("AVAIL-009", "UTC label aliases map to canonical offers while whole and fractional seconds remain off increment", async () => {
  const proof = fixture(); for (const start of ["2030-06-03T09:00:00Z", "2030-06-03T09:00:00.0000Z"]) assert.equal((await proof.verify(start)).kind, "valid");
  for (const start of ["2030-06-03T09:00:01.000Z", "2030-06-03T09:00:00.001Z"]) assert.deepEqual(await rules(proof, start), ["start_increment"]);
});
contract("AVAIL-009", "DST and one-window diagnoses agree with independent actual offers around every transition candidate", async () => {
  const cases = [["America/New_York", "2026-03-08", "2026-03-08T05:00:00.000Z", 360, 90, [{ weekday: 0, startMinute: 60, endMinute: 210 }]], ["America/New_York", "2026-11-01", "2026-11-01T04:00:00.000Z", 360, 90, [{ weekday: 0, startMinute: 60, endMinute: 120 }]], ["Australia/Lord_Howe", "2026-04-05", "2026-04-04T13:00:00.000Z", 360, 30, [{ weekday: 0, startMinute: 60, endMinute: 180 }]], ["UTC", "2026-11-01", "2026-11-01T08:00:00.000Z", 300, 90, [{ weekday: 0, startMinute: 540, endMinute: 600 }, { weekday: 0, startMinute: 600, endMinute: 660 }]]];
  for (const [zone, day, first, minutes, durationMinutes, availability] of cases) {
    const proof = fixture({ zone, event: { durationMinutes, slotIncrementMinutes: 30, availability, beforeBufferMinutes: 0, afterBufferMinutes: 0 } }), at = new Date("2026-01-01T00:00:00.000Z");
    const valid = new Set((await proof.publicWeek(day, at)).slots.map((slot) => slot.startAt));
    for (let minute = 0; minute < minutes; minute += 15) { const start = new Date(Date.parse(first) + minute * 60_000).toISOString(); const result = await proof.diagnose(start, undefined, at); assert.equal(result.diagnosis.valid, valid.has(start), `${zone} ${start}: ${result.diagnosis.exclusions}`); }
  }
});
contract("AVAIL-009", "diagnosis projection and human explanations disclose only allowlisted rules", async () => {
  const result = await fixture({ busy: [{ startAt: selected, endAt: "2030-06-03T09:10:00.000Z", title: "private external title", eventId: "private-provider-id", attendee: "private@example.test" }] }).diagnose();
  assert.doesNotMatch(JSON.stringify(result), /private external|private-provider|private@example/); assert.equal(core.unavailableTimeMessage(result.diagnosis.exclusions), "That time is unavailable: overlaps conflict-calendar busy time.");
});
contract("AVAIL-009", "nonzero sub-millisecond fractions are rejected before Date rounding or any provider read", async () => {
  for (const start of ["2030-06-03T09:00:00.0001Z", "2030-06-03T09:00:00.0011Z"]) {
    const proof = fixture(); assert.equal((await proof.diagnose(start)).kind, "invalid_time"); assert.deepEqual(await proof.verify(start), { kind: "slot_invalid", exclusions: ["start_increment"] }); assert.equal(proof.reads.length, 0);
  }
});
async function loadCore() {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-diagnostics-core-"));
  try { const output = resolve(directory, "core.mjs"); await build({ entryPoints: [new URL("../src/core/features/availability/index.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" }); return await import(pathToFileURL(output).href); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
