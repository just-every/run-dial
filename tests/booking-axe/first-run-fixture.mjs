import assert from "node:assert/strict";

// Finish through the same authenticated product APIs used by the setup editors.
// Removing the event afterwards leaves a real completed, empty activity workspace.
export async function completeEmptyWorkspace(owner, origin) {
  const headers = { Origin: origin };
  const get = async path => {
    const response = await owner.request.get(origin + path);
    assert.equal(response.status(), 200, `GET ${path}`);
    return response.json();
  };
  const post = async (path, data, expected = 200, extraHeaders = {}) => {
    const response = await owner.request.post(origin + path, { headers: { ...headers, ...extraHeaders }, data });
    assert.equal(response.status(), expected, `POST ${path}`);
    return response.json();
  };
  assert.equal((await get("/api/app/host-setup")).completedAt, null);
  assert.equal(await get("/api/app/profile"), null);
  for (const path of ["/api/app/bookings", "/api/app/availability-requests"]) {
    assert.deepEqual(await get(path), [], "native activity APIs are callable before completion");
  }
  const profile = await owner.request.patch(origin + "/api/app/profile", { headers, data: {
    handle: "axe-host", name: "Axe Host", title: "Advisor", biography: "A configured accessibility review workspace.", timezone: "UTC", focusAreas: [], socialProof: [],
  } });
  assert.equal(profile.status(), 200);
  assert.equal((await post("/api/app/mail/check", {})).state, "healthy");
  const event = await post("/api/app/event-types", {
    slug: "first-run", title: "First conversation", description: "Request a future conversation.", durationMinutes: 30,
    color: "#176b5a", locationType: "phone", locationLabel: "Phone", locationValue: "+1 202 555 0100",
    listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0,
    bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], hours: { uses: "own", windows: [] },
  }, 201);
  const published = await post(`/api/app/event-types/${event.id}/open-requests`, {});
  assert.equal(published.status, "published");
  assert.equal(published.requestOnly, true);
  const state = await get("/api/app/host-setup");
  assert.equal(state.calendar.state, "disconnected", "request-only setup needs no calendar");
  assert.equal(state.availabilityReady, false, "request-only setup needs no availability window");
  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].eventTypeId, event.id);
  await post(`/api/app/event-types/${event.id}/copy-report`, { url: state.links[0].url }, 200, { "X-Dial-Copy-Report": "1" });
  const completed = await post("/api/app/host-setup/complete", {});
  assert.equal(completed.kind, "completed");
  assert.ok(Number.isFinite(Date.parse(completed.completedAt)), "completion records its server timestamp");
  const removed = await owner.request.delete(origin + `/api/app/event-types/${event.id}`, { headers });
  assert.equal(removed.status(), 204);
  assert.deepEqual(await get("/api/app/event-types"), []);
  assert.equal((await get("/api/app/host-setup")).completedAt, completed.completedAt, "deleting the last event preserves completion");
}
