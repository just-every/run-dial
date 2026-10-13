import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function seedOverviewRecords(owner, origin) {
  const fixture = await post(owner, origin, "/__fixtures/setup", {});
  const calendarHealth = await getJson(owner, origin, "/api/app/calendar/connection");
  const event = await getJson(owner, origin, `/api/app/event-types/${fixture.eventId}`);
  const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const availability = await getJson(owner, origin, `/api/public/book/dial-host/intro/availability?week=${futureDate}`);
  const slots = availability.slots;
  assert.ok(slots.length >= 2, "the native fixture exposes two future booking slots");

  const answer = event.questions[0];
  assert.ok(answer?.key, "the native event fixture has its required question");
  const createdBookings = [];
  for (const [index, slot] of [[0, slots[0]], [1, slots[1]]]) {
    const inviteeName = index === 0 ? "Earlier dashboard booking" : "Latest dashboard booking";
    const booking = await post(owner, origin, "/api/app/bookings", {
      idempotencyKey: randomUUID(),
      eventTypeId: fixture.eventId,
      startAt: slot.startAt,
      inviteeTimezone: "UTC",
      name: inviteeName,
      email: `overview-booking-${index}@dial.test`,
      answers: { [answer.key]: "Dashboard review fixture" },
      overrideNoticeAndHorizon: false,
    }, 201);
    createdBookings.push(booking);
    await pause(25);
    if (index === 0) await verifyCountBoundary(owner, origin, booking);
  }

  const requestDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const createdRequests = [];
  for (const index of [0, 1]) {
    const inviteeName = index === 0 ? "Earlier dashboard request" : "Latest dashboard request";
    const composition = {
      inviteeName,
      inviteeEmail: `overview-request-${index}@dial.test`,
      inviteeTimezone: "UTC",
      note: "Dashboard review fixture",
      windows: [{ date: requestDate, startMinute: 600 + index * 120, endMinute: 660 + index * 120 }],
    };
    const review = await post(owner, origin, "/api/public/events/dial-host/intro/request/review", composition, 201);
    await post(owner, origin, `/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, composition, 201);
    createdRequests.push(composition);
    await pause(25);
  }

  const defaultBookingsResponse = await owner.request.get(`${origin}/api/app/bookings`);
  assert.equal(defaultBookingsResponse.status(), 200, "native operator booking list responds successfully");
  const bookings = await defaultBookingsResponse.json();
  const requests = await getJson(owner, origin, "/api/app/availability-requests");
  assert.equal(bookings.length, 2, "two real bookings were created through the native operator endpoint");
  assert.equal(defaultBookingsResponse.headers()["x-total-count"], "2", "native operator booking list reports the exact count in a header while keeping its array body");
  assert.equal(requests.length, 2, "two open requests were created through the native public endpoints");
  assert.ok(requests.every((request) => request.state === "submitted"), "both seeded requests remain open");
  const createdBookingsResponse = await owner.request.get(`${origin}/api/app/bookings?order=created`);
  assert.equal(createdBookingsResponse.status(), 200, "native operator booking list accepts opt-in creation order");
  assert.equal(createdBookingsResponse.headers()["x-total-count"], "2", "the creation-ordered list reports the same actual total");
  const orderedBookings = await createdBookingsResponse.json();
  assert.deepEqual(
    orderedBookings.map((booking) => booking.inviteeName),
    [...bookings].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).map((booking) => booking.inviteeName),
    "creation-order API includes the newest booking ahead of occurrence-sorted records",
  );
  const filteredBookingsResponse = await owner.request.get(`${origin}/api/app/bookings?state=confirmed`);
  assert.equal(filteredBookingsResponse.headers()["x-total-count"], "2", "the exact total honors the supplied state filter");
  const noMatchResponse = await owner.request.get(`${origin}/api/app/bookings?state=cancelled`);
  assert.equal(noMatchResponse.headers()["x-total-count"], "0", "a no-match filter has an exact zero count");
  assert.notDeepEqual(
    bookings.map((booking) => booking.inviteeName),
    [...bookings].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).map((booking) => booking.inviteeName),
    "the native default booking list order differs from creation recency",
  );
  assert.deepEqual(
    bookings.map((booking) => booking.occurrence.startAt),
    [...bookings].sort((left, right) => Date.parse(left.occurrence.startAt) - Date.parse(right.occurrence.startAt)).map((booking) => booking.occurrence.startAt),
    "the native default booking list keeps its occurrence-start ordering",
  );
  assert.notDeepEqual(
    requests.map((request) => request.inviteeName),
    [...requests].sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt)).map((request) => request.inviteeName),
    "the native request list is oldest first and must be reversed for recent activity",
  );
  return { bookings, requests, calendarState: calendarHealth.state };
}

async function verifyCountBoundary(owner, origin, sourceBooking) {
  const fixture = await post(owner, origin, "/__fixtures/bookings-501", { bookingId: sourceBooking.id });
  assert.equal(fixture.count, 501, "the test-only D1 fixture creates 500 additional rows beside one native booking");

  const defaultResponse = await owner.request.get(`${origin}/api/app/bookings`);
  assert.equal(defaultResponse.status(), 200);
  assert.equal(defaultResponse.headers()["x-total-count"], "501", "the exact count includes the record beyond the default 500-row cap");
  const defaultRows = await defaultResponse.json();
  assert.ok(Array.isArray(defaultRows), "the existing booking list response remains an array");
  assert.equal(defaultRows.length, 500, "the default booking list body remains capped at 500");
  assert.ok(!defaultRows.some((booking) => booking.id === fixture.newestBookingId), "the latest-created record is outside the occurrence-sorted first 500");
  assert.ok(defaultRows.every((booking, index) => index === 0 || Date.parse(defaultRows[index - 1].occurrence.startAt) < Date.parse(booking.occurrence.startAt)), "the default booking list remains ordered by occurrence start");

  const recentResponse = await owner.request.get(`${origin}/api/app/bookings?order=created&limit=1`);
  assert.equal(recentResponse.status(), 200, "the same list accepts opt-in creation order and a small limit");
  assert.equal(recentResponse.headers()["x-total-count"], "501", "the count header ignores the display limit");
  const newestRows = await recentResponse.json();
  assert.equal(newestRows.length, 1, "the requested creation-order limit applies only to the array body");
  assert.equal(newestRows[0].id, fixture.newestBookingId, "creation order returns the newest record beyond the default 500");

  const confirmedResponse = await owner.request.get(`${origin}/api/app/bookings?state=confirmed&limit=1`);
  assert.equal(confirmedResponse.headers()["x-total-count"], "501", "the exact count retains lifecycle filters before applying the display limit");
  const noMatchResponse = await owner.request.get(`${origin}/api/app/bookings?state=cancelled`);
  assert.equal(noMatchResponse.headers()["x-total-count"], "0", "a no-match filter has an exact zero count");
  for (const limit of ["0", "501", "invalid"]) {
    assert.equal((await owner.request.get(`${origin}/api/app/bookings?limit=${limit}`)).status(), 400, `invalid list limit ${limit} is rejected`);
  }

  await post(owner, origin, "/__fixtures/bookings-501", { clear: true }, 204);
  const clearedResponse = await owner.request.get(`${origin}/api/app/bookings`);
  assert.equal(clearedResponse.headers()["x-total-count"], "1", "fixture cleanup leaves the one native source booking");
  assert.equal((await clearedResponse.json()).length, 1);
}

export async function resetOverviewFixture(owner, origin) {
  const reset = await owner.request.post(`${origin}/__fixtures/reset`);
  assert.equal(reset.status(), 204, "the test-only fixture cleanup removed the seeded activity");
  const disconnected = await owner.request.delete(`${origin}/api/app/calendar/connection`, { headers: { Origin: origin } });
  assert.equal(disconnected.status(), 204, "the test-only connection is returned to the request-only journey");
}

async function getJson(owner, origin, path) {
  const response = await owner.request.get(`${origin}${path}`);
  if (response.status() !== 200) throw new Error(`GET ${path} returned ${response.status()}: ${await response.text()}`);
  return response.json();
}

async function post(owner, origin, path, body, expectedStatus = 200) {
  const response = await owner.request.post(`${origin}${path}`, { data: body, headers: { Origin: origin } });
  if (response.status() !== expectedStatus) throw new Error(`POST ${path} returned ${response.status()}: ${await response.text()}`);
  return expectedStatus === 204 ? undefined : response.json();
}
