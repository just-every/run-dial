import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingMail, textBody } from "./mail-contracts.mjs";

export async function locationJourney({ data, call, state, deliver, future, checks }) {
  const locations = [
    { id: "video", type: "google_meet", label: "Video call", value: "" },
    { id: "link", type: "fixed_link", label: "Private meeting link", value: "https://meet.example.test/private-location" },
    { id: "phone", type: "phone", label: "Call the host", value: "+14155552671" },
    { id: "office", type: "in_person", label: "Host office", value: "82 Private Street, Brisbane" },
    { id: "ask", type: "ask_invitee", label: "Your meeting place", value: "", prompt: "What address, number or link should we use?" },
    { id: "callback", type: "invitee_phone", label: "Host calls you", value: "" },
  ];
  const event = await data("/api/app/event-types", {
    slug: "location-choice", title: "Location consultation", description: "Choose where we meet.",
    durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Video call", locationValue: "", locations,
    listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 780, endMinute: 1080 })),
  }, 201);
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const publicEvent = await data(`/api/public/events/dial-host/${event.slug}`);
  for (const option of locations.filter(option => option.value)) assert.ok(!JSON.stringify(publicEvent).includes(option.value), "private offered values do not escape the public projection");
  const copy = await data(`/api/app/event-types/${event.id}/duplicate`, {}, 201);
  assert.deepEqual(copy.locations, locations);
  for (const option of locations) {
    const slot = (await data(`${base}/availability?week=${future}`)).slots[0];
    assert.ok(slot);
    const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
    const query = new URLSearchParams({ nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC" });
    const lookup = await data(`${base}/selection?${query}`);
    for (const location of locations.filter(location => location.value)) assert.ok(!JSON.stringify(lookup).includes(location.value));
    const payload = { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Location guest", email: `location-${option.id}@dial.test`, answers: {}, locationId: option.id };
    const before = await state();
    await call(`${base}/confirm`, { ...payload, locationId: undefined }, 400);
    await call(`${base}/confirm`, { ...payload, locationId: "unoffered" }, 400);
    let value = option.value;
    if (option.type === "ask_invitee") {
      await call(`${base}/confirm`, { ...payload, locationInput: "  " }, 400);
      payload.locationInput = "Invitee private boardroom, 42 Choice Lane";
      value = payload.locationInput;
    }
    if (option.type === "invitee_phone") {
      await call(`${base}/confirm`, { ...payload, locationInput: "not a phone" }, 400);
      payload.locationInput = "(415) 555-2672";
      value = "+14155552672";
    }
    assert.equal((await state()).bookings.length, before.bookings.length);
    const receipt = await data(`${base}/confirm`, payload, 201);
    await call(`${base}/confirm`, payload, 200);
    await call(`${base}/confirm`, { ...payload, locationId: "office" === option.id ? "phone" : "office" }, 409);
    assert.equal(receipt.location.label, option.label);
    if (value) assert.equal(receipt.location.value, value);
    await deliver();
    const snapshot = await state();
    const booking = snapshot.bookings.find(row => row.invitee_email === payload.email);
    assert.equal(booking.location_type, option.type); assert.equal(booking.location_label, option.label);
    if (value) assert.equal(booking.location_value, value);
    const writes = snapshot.wire_calls.filter(row => ["POST", "PATCH"].includes(row.method) && new URL(row.url).pathname.includes("/events")).map(row => JSON.parse(row.body)).filter(body => body.extendedProperties?.private?.["dial-booking-id"] === booking.id);
    assert.ok(writes.length);
    if (option.type === "google_meet") assert.ok(writes.some(body => body.conferenceData?.createRequest));
    else { assert.ok(writes.every(body => !body.conferenceData?.createRequest)); assert.ok(writes.some(body => body.location === value)); }
    const messages = bookingMail(snapshot, booking.id);
    for (const message of messages) {
      if (value) assert.ok(textBody(message).includes(value), "selected private location reaches booking correspondents");
      for (const other of locations.filter(other => other.value && other.id !== option.id)) assert.ok(!textBody(message).includes(other.value), "unchosen private location is never mailed");
    }
    assert.ok(messages.length);
    const ics = await (await call(new URL(receipt.icsUrl).pathname)).text();
    if (value) assert.ok(ics.replace(/\r?\n /g, "").replaceAll("\\,", ",").includes(value));
  }
  // EVENT-004/DATA-002: the invitee phone given as a location is erased with the invitee's records.
  const phoneEmail = "location-callback@dial.test", stored = snapshot => JSON.stringify(Object.entries(snapshot).filter(([table]) => !table.startsWith("wire_")));
  assert.equal((await state()).bookings.find(row => row.invitee_email === phoneEmail).location_value, "+14155552672");
  const preview = await data("/api/app/privacy/preview", { email: phoneEmail });
  await data("/api/app/privacy/erase", { email: phoneEmail, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  const erased = await state();
  assert.ok(!erased.bookings.some(row => row.invitee_email === phoneEmail));
  assert.ok(!stored(erased).includes("4155552672"), "the invitee phone location survives in no product table after erasure");
  const slot = (await data(`${base}/availability?week=${future}`)).slots[0];
  const operatorInput = { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Agreed location guest", email: "location-agreed@dial.test", answers: {}, overrideNoticeAndHorizon: false };
  await call("/api/app/bookings", operatorInput, 400);
  const operatorBooking = await data("/api/app/bookings", { ...operatorInput, locationId: "ask", locationInput: "Agreed private location" }, 201);
  assert.equal(operatorBooking.locationValue, "Agreed private location");
  await call("/api/app/bookings", { ...operatorInput, locationId: "ask", locationInput: "Agreed private location" }, 200);
  await call("/api/app/bookings", { ...operatorInput, locationId: "office" }, 409);
  await data(`/api/app/event-types/${event.id}/details`, { ...event, availability: undefined, alternativeRequestsEnabled: undefined, locations: [locations.find(option => option.id === "office")] }, 200, "PATCH");
  const next = (await data(`${base}/availability?week=${future}`)).slots[0];
  const moved = await data(`/api/app/bookings/${operatorBooking.id}/reschedule`, { startAt: next.startAt, inviteeTimezone: "UTC", overridePublishedAvailability: false });
  assert.equal(moved.locationValue, "Agreed private location");
  await deliver();
  const moveSnapshot = await state();
  const moveWrites = moveSnapshot.wire_calls.filter(row => ["POST", "PATCH"].includes(row.method) && new URL(row.url).pathname.includes("/events")).map(row => JSON.parse(row.body)).filter(body => body.extendedProperties?.private?.["dial-booking-id"] === operatorBooking.id);
  assert.ok(moveWrites.length && moveWrites.every(body => body.location === "Agreed private location"));
  checks.push("EVENT-004/EVENT-006: invitee phone location erased with the invitee (DATA-002); native multi-location editor/API and duplication, label-only public event/selection, required choice and invitee place/phone, E.164 storage, immutable replay and only chosen conference/calendar/mail/receipt disclosure");
}
