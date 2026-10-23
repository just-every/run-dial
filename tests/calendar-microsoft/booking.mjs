import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function microsoftBookingLifecycle({ data }) {
  await data("/api/app/profile", { handle: "synthetic-dial-1627", name: "Synthetic Dial 1627", title: "Host", biography: "Synthetic provider proof", timezone: "Australia/Brisbane", focusAreas: [], socialProof: [] }, 200, "PATCH");
  await data("/api/app/mail/check", {});
  const event = await data("/api/app/event-types", { slug: "synthetic-dial-1628", title: "Synthetic Dial 1628", description: "Synthetic booking with a selected calendar", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Synthetic room", locationValue: "https://meeting.example.test/synthetic-dial-1629", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  const google = await data("/api/app/event-types", { ...event, slug: "synthetic-dial-1632", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", locations: [{ id: "synthetic-dial-1632", type: "google_meet", label: "Google Meet", value: "" }] }, 201);
  const refusal = await data(`/api/app/event-types/${google.id}/publish`, {}, 409);
  assert.ok(refusal.error.details.includes("google_meet_capability"), "a Microsoft connection never advertises Google conferencing");
  const config = await data(`/api/app/event-types/${event.id}/correspondence`);
  await data(`/api/app/event-types/${event.id}/correspondence`, { inviteeConfirmationEnabled: true, invitationManageLinkEnabled: true, templates: { ...config.templates, calendarTitle: "{invitee full name} & {host name}", calendarDescription: "Synthetic resources for {event name}" } }, 200, "PUT");
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const startAt = new Date(Date.now() + 10 * 86400000); startAt.setUTCHours(11, 0, 0, 0);
  const create = async (at, suffix) => data("/api/app/bookings", { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: at.toISOString(), inviteeTimezone: "America/New_York", name: `Synthetic Dial ${suffix}`, email: `synthetic-dial-${suffix}@example.test`, answers: {}, overrideNoticeAndHorizon: false }, 201);
  const booking = await create(startAt, 1630); await data("/__fixtures/delivery", {});
  let stored = await data(`/api/app/bookings/${booking.id}`), facts = await data("/__fixtures/facts");
  const graphEvent = facts.events.find(item => item.id === stored.calendarProviderEventId); assert.ok(graphEvent);
  assert.equal(graphEvent.subject, "Synthetic Dial 1630 & Synthetic Dial 1627"); assert.match(graphEvent.body.content, /Synthetic resources for Synthetic Dial 1628/); assert.match(graphEvent.body.content, /\/manage\/invite\//);
  assert.equal(graphEvent.attendees[0].emailAddress.address, "synthetic-dial-1630@example.test");
  assert.ok(graphEvent.singleValueExtendedProperties.some(property => property.value === stored.icalUid));
  const providerId = stored.calendarProviderEventId, uid = stored.icalUid;
  const moved = new Date(startAt.valueOf() + 86400000);
  await data(`/api/app/bookings/${booking.id}/reschedule`, { startAt: moved.toISOString(), inviteeTimezone: "America/New_York", overridePublishedAvailability: false }); await data("/__fixtures/delivery", {});
  stored = await data(`/api/app/bookings/${booking.id}`); assert.equal(stored.calendarProviderEventId, providerId); assert.equal(stored.icalUid, uid);
  facts = await data("/__fixtures/facts"); assert.equal(facts.events.filter(item => item.id === providerId).length, 1); assert.equal(facts.events.find(item => item.id === providerId).start.dateTime, moved.toISOString().replace(/Z$/, ""));
  await data(`/api/app/bookings/${booking.id}/cancel`, {}); await data("/__fixtures/delivery", {}); assert.equal((await data("/__fixtures/facts")).events.some(item => item.id === providerId), false);
  const external = await create(new Date(moved.valueOf() + 86400000), 1631); await data("/__fixtures/delivery", {});
  await data("/__fixtures/control", { deleteEvents: true }, 204); assert.equal((await data("/__fixtures/sync", {})).kind, "synced"); assert.equal((await data("/__fixtures/sync", {})).kind, "synced");
  const cancelled = await data(`/api/app/bookings/${external.id}`); assert.equal(cancelled.state, "cancelled");
  const history = await data(`/__fixtures/cancellations?id=${external.id}`); assert.equal(history.count, 1, "repeated delta tombstones cancel and notify through one native lifecycle transition");
}
