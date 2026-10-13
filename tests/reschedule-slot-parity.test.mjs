import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
const bundled = await build({ stdin: { contents: 'export { AvailabilityService } from "./src/core/features/availability/service";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { AvailabilityService } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
contract("BOOK-007", "every Brisbane reschedule offer passes the same native fresh selection engine", async () => {
  const event = { id: "event", slug: "session", status: "published", durationMinutes: 30, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })), slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 60, beforeBufferMinutes: 15, afterBufferMinutes: 15, hostDayBookingLimit: null };
  const current = { id: "current", startAt: "2026-11-02T00:00:00.000Z", endAt: "2026-11-02T00:30:00.000Z", hostDate: "2026-11-02" };
  const other = { id: "other", startAt: "2026-11-02T01:00:00.000Z", endAt: "2026-11-02T01:30:00.000Z", hostDate: "2026-11-02" };
  const profiles = { getProfile: async () => ({ handle: "host", timezone: "Australia/Brisbane" }), getPublicProfile: async () => ({ handle: "host", timezone: "Australia/Brisbane" }) };
  const events = { getEventType: async () => event, resolvePublishedEventForPublicRequest: async () => event, listDateAvailabilityOverrides: async () => [] };
  const service = new AvailabilityService({ listOwnCalendarEvents: async () => [], listInternalClaims: async (_start, _end, excluded) => [current, other].filter(booking => booking.id !== excluded) }, profiles, events, { readBusy: async () => ({ kind: "ok", intervals: [] }) });
  const now = new Date("2026-10-31T00:00:00Z");
  const offers = await service.listRescheduleWeek("event", "current", "2026-11-02", "Australia/Brisbane", now);
  assert.equal(offers.state, "available"); assert.ok(offers.slots.length > 50);
  for (const slot of offers.slots) { const result = await service.verifyPublicSelection("host", "session", slot.startAt, now, "current"); assert.equal(result.kind, "valid"); assert.equal(result.slot.startAt, slot.startAt); }
  assert.equal((await service.verifyPublicSelection("host", "session", other.startAt, now, "current")).kind, "slot_invalid");
});
