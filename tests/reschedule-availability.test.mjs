import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

const bundled = await build({ stdin: { contents: 'export { BookingsService } from "./src/core/features/bookings/service"; export { AvailabilityService } from "./src/core/features/availability/service"; export { publicBookingRoutes } from "./src/core/features/public-booking/routes"; export { hashToken } from "./src/core/platform/auth/tokens"; export { Hono } from "hono";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { BookingsService, AvailabilityService, publicBookingRoutes, hashToken, Hono } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const secret = "synthetic-reschedule-availability-secret";
const week = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const instant = time => `${week}T${time}:00.000Z`;
const event = { id: "event-a", slug: "session", status: "published", durationMinutes: 30, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720 })), slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null };
async function fixture(overrides = {}) {
  const currentEvent = { ...event, ...overrides };
  const tokens = new Map(), calls = [], claims = [{ id: "booking-a", startAt: instant("10:00"), endAt: instant("10:30"), hostDate: week }, { id: "booking-b", startAt: instant("10:30"), endAt: instant("11:00"), hostDate: week }];
  const profiles = { getProfile: async () => ({ handle: "host", timezone: "UTC" }), getPublicProfile: async () => ({ handle: "host", timezone: "UTC" }) };
  const events = { getEventType: async id => id === currentEvent.id ? currentEvent : undefined, resolvePublishedEventForPublicRequest: async () => currentEvent, listDateAvailabilityOverrides: async () => [] };
  let busy = { kind: "ok", intervals: [] };
  const availability = new AvailabilityService({ listOwnCalendarEvents: async () => [], listInternalClaims: async (_start, _end, excluded) => { calls.push(excluded); return claims.filter(c => c.id !== excluded); } }, profiles, events, { readBusy: async () => busy });
  const repository = { findManageToken: async hash => tokens.get(hash), createNonce: async () => { throw Error("No nonce should be created by availability reads or invalid selection"); } };
  const bookings = new BookingsService(repository, availability, profiles, events, { SESSION_SECRET: secret }, {});
  const booking = id => ({ id, eventTypeId: event.id, state: "confirmed", occurrence: { startAt: instant("10:00") } });
  for (const [token, access] of [["token-a", { status: "active", booking: booking("booking-a") }], ["token-b", { status: "active", booking: booking("booking-b") }], ["expired", { status: "expired", booking: booking("booking-a") }], ["rotated", { status: "rotated", booking: booking("booking-a") }], ["cancelled", { status: "active", booking: { ...booking("booking-a"), state: "cancelled" } }], ["past", { status: "active", booking: { ...booking("booking-a"), occurrence: { startAt: "2000-01-01T10:00:00Z" } } }]]) tokens.set(await hashToken(token, secret), access);
  const app = new Hono(); app.use("*", async (c, next) => { c.set("services", { bookings }); await next(); }); app.route("/", publicBookingRoutes);
  return { app, calls, claims, bookings, tokens, setBusy(value) { busy = value; } };
}
const url = (token, extra = "") => `/api/public/manage/${token}/reschedule/availability?week=${week}${extra}`;
contract("AUTH-003", "availability requires the existing booking token; unknown, expired and rotated tokens reveal no slots", async () => {
  const f = await fixture();
  for (const [token, status] of [["unknown", 404], ["booking-a", 404], ["invitee@example.test", 404], ["expired", 410], ["rotated", 410]]) {
    const response = await f.app.request(url(token)); assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /startAt|endAt|booking-a|invitee/);
  }
  assert.equal(f.calls.length, 0);
});
contract("BOOK-007", "only the token's current booking is excluded and cross-booking override parameters are refused", async () => {
  const f = await fixture();
  const a = await (await f.app.request(url("token-a"))).json();
  assert.equal(a.state, "available"); assert.ok(a.slots.some(s => s.startAt === instant("10:00"))); assert.ok(!a.slots.some(s => s.startAt === instant("10:30")));
  const b = await (await f.app.request(url("token-b"))).json();
  assert.ok(!b.slots.some(s => s.startAt === instant("10:00"))); assert.ok(b.slots.some(s => s.startAt === instant("10:30")));
  assert.deepEqual(f.calls, ["booking-a", "booking-b"]);
  for (const extra of ["&excludedBookingId=booking-b", "&bookingId=booking-b", "&eventTypeId=other", "&inviteeTimezone=Mars%2FOlympus", "&week=not-a-date"]) assert.equal((await f.app.request(url("token-a", extra))).status, 400);
  assert.doesNotMatch(JSON.stringify(a), /booking-a|booking-b|token-a|event-a|inviteeEmail/);
});
contract("BOOK-007", "availability is an offer only: stale slot recheck refuses selection and leaves the original booking untouched", async () => {
  const f = await fixture(); const offered = await (await f.app.request(url("token-a"))).json();
  assert.ok(offered.slots.some(s => s.startAt === instant("11:00")));
  f.claims.push({ id: "concurrent-booking", startAt: instant("11:00"), endAt: instant("11:30"), hostDate: week });
  const response = await f.app.request("/api/public/manage/token-a/reschedule/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startAt: instant("11:00"), inviteeTimezone: "UTC" }) });
  assert.equal(response.status, 409);
  assert.equal((await f.tokens.get(await hashToken("token-a", secret))).booking.occurrence.startAt, instant("10:00"));
  assert.equal(f.calls.at(-1), "booking-a");
});
contract("AVAIL-004", "closed change window refuses reads and calendar failure offers no unverified slot", async () => {
  const f = await fixture();
  for (const token of ["cancelled", "past"]) assert.equal((await f.app.request(url(token))).status, 409);
  assert.equal(f.calls.length, 0);
  f.setBusy({ kind: "unavailable", code: "synthetic-unreadable" });
  const response = await f.app.request(url("token-a")); const body = await response.json();
  assert.equal(body.state, "temporarily_unavailable"); assert.deepEqual(body.slots, []);
});

contract("AVAIL-003", "reschedule offers retain other bookings' host-day cap and buffers and never bypass publication", async () => {
  const capped = await fixture({ hostDayBookingLimit: 1 });
  const capBody = await (await capped.app.request(url("token-a"))).json();
  assert.ok(!capBody.slots.some(s => s.hostDate === week));
  const buffered = await fixture({ beforeBufferMinutes: 15, afterBufferMinutes: 15 });
  const bufferBody = await (await buffered.app.request(url("token-a"))).json();
  assert.ok(!bufferBody.slots.some(s => s.startAt === instant("10:00") || s.startAt === instant("11:00")));
  assert.ok(bufferBody.slots.some(s => s.startAt === instant("11:30")));
  const disabled = await fixture({ status: "disabled" });
  const response = await disabled.app.request(url("token-a")); assert.equal(response.status, 404);
  assert.equal(disabled.calls.length, 0);
});
