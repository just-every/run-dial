import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

export async function teamsLifecycle({ data, event, startAt, call }) {
  const teams = await data("/api/app/event-types", { ...event, slug: "synthetic-dial-1633", locationType: "microsoft_teams", locationLabel: "Microsoft Teams", locationValue: "", locations: [{ id: "synthetic-dial-1634", type: "microsoft_teams", label: "Microsoft Teams", value: "" }, { id: "synthetic-dial-1635", type: "phone", label: "Call the host", value: "+12025550163" }] }, 201);
  await data(`/api/app/event-types/${teams.id}/publish`, {});
  const create = async (locationId, days, suffix) => {
    const at = new Date(startAt.valueOf() + days * 86400000).toISOString(), base = `/api/public/book/synthetic-dial-1627/${teams.slug}`;
    const selection = await data(base + "/selection", { startAt: at, inviteeTimezone: "UTC" }, 201);
    return data(base + "/confirm", { startAt: at, inviteeTimezone: "UTC", nonce: selection.nonce, name: `Synthetic Dial ${suffix}`, email: `synthetic-dial-${suffix}@example.test`, answers: {}, locationId }, 201);
  };
  const confirmation = await create("synthetic-dial-1634", 4, 1636);
  assert.equal(confirmation.location.state, "pending"); assert.equal(confirmation.location.value, undefined, "no joining link before the provider confirms it");
  await data("/__fixtures/delivery", {});
  const bookingId = confirmation.bookingReference, token = confirmation.manageUrl.split("/").at(-1);
  let stored = await data(`/api/app/bookings/${bookingId}`), receipt = await data(`/api/public/manage/${token}`);
  const providerId = stored.calendarProviderEventId, joinUrl = stored.meetingUrl;
  assert.match(joinUrl, /^https:\/\/teams\.example\.test\//); assert.equal(receipt.location.value, joinUrl);
  let facts = await data("/__fixtures/facts"); assert.equal(facts.events.find(item => item.id === providerId).onlineMeeting.joinUrl, joinUrl);
  const locationMails = facts.mail.filter(row => row.bookingId === bookingId).map(row => JSON.stringify(row.payload));
  assert.ok(locationMails.some(mail => mail.includes(joinUrl)), "native link-ready mail carries only the confirmed joining link");
  await data(`/api/app/bookings/${bookingId}/reschedule`, { startAt: new Date(startAt.valueOf() + 5 * 86400000).toISOString(), inviteeTimezone: "UTC", overridePublishedAvailability: false }); await data("/__fixtures/delivery", {});
  stored = await data(`/api/app/bookings/${bookingId}`); assert.equal(stored.calendarProviderEventId, providerId); assert.equal(stored.meetingUrl, joinUrl);
  await data(`/api/app/bookings/${bookingId}/cancel`, {}); await data("/__fixtures/delivery", {});
  assert.equal((await data(`/api/app/bookings/${bookingId}`)).meetingUrl, null); assert.equal((await data("/__fixtures/facts")).events.some(item => item.id === providerId), false);
  const phone = await create("synthetic-dial-1635", 6, 1637); await data("/__fixtures/delivery", {});
  const phoneBooking = await data(`/api/app/bookings/${phone.bookingReference}`); assert.equal(phoneBooking.meetingUrl, null); assert.equal(phone.location.value, "+12025550163");
  facts = await data("/__fixtures/facts"); const phoneEvent = facts.events.find(item => item.id === phoneBooking.calendarProviderEventId); assert.ok(phoneEvent); assert.equal(phoneEvent.onlineMeeting, undefined);
  assert.ok(facts.mail.filter(row => row.bookingId === phone.bookingReference).every(row => !JSON.stringify(row.payload).includes("teams.example.test")), "the other location provisions and discloses no Teams conference");
  const start = await call("/api/app/calendar/oauth/start?provider=microsoft", undefined, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state"), decoded = JSON.parse(Buffer.from(state.split(".")[0], "base64url"));
  // A valid session-bound state for the other provider must be refused before any token exchange.
  const body = Buffer.from(JSON.stringify({ ...decoded, provider: "google" })).toString("base64url"), signed = body + "." + createHmac("sha256", "synthetic-dial-1616-at-least-thirty-two-characters").update(body).digest("base64url");
  const beforeTokens = facts.calls.filter(call => call.path.endsWith("/token")).length;
  const refused = await data("/api/calendar/oauth/callback?" + new URLSearchParams({ state: signed, code: "synthetic-dial-1639" }), undefined, 409); assert.equal(refused.error.code, "calendar_provider_switch_blocked");
  assert.equal((await data("/__fixtures/facts")).calls.filter(call => call.path.endsWith("/token")).length, beforeTokens);
}
