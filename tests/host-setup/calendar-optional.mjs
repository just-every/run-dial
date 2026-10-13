import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { evidencePath } from "../../scripts/evidence-path.mjs";

/** The same cold-host journey continues through a real signed-out booking and independent contenders. */
export async function calendarOptionalJourney(browser, owner, origin, eventId, width, scan) {
  const visitor = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "UTC" });
  const competitor = await browser.newContext();
  const headers = { Origin: origin };
  const path = "/api/public/book/fresh-host/first-event";
  try {
    const guest = await visitor.newPage();
    await guest.goto(origin + "/book/fresh-host/first-event");
    await expect(guest.locator(".pb-slot-button").first()).toBeVisible();
    const startAt = await guest.locator(".pb-slot-button").first().getAttribute("data-start-at");
    assert.ok(startAt);
    await guest.locator(".pb-slot-button").first().click();
    await guest.getByLabel("Name", { exact: true }).fill("Schedule guest");
    await guest.getByLabel("Email", { exact: true }).fill("schedule-guest@example.test");
    await guest.getByRole("button", { name: "Confirm booking", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "Booking confirmed.", exact: true })).toBeVisible();
    await expect(guest.getByText(/Calendar and joining details are still being prepared/)).toHaveCount(0);
    const manageUrl = await guest.getByRole("link", { name: "Manage booking", exact: true }).getAttribute("href");
    const token = new URL(manageUrl, origin).pathname.split("/").at(-1);
    const receipt = await (await visitor.request.get(origin + `/api/public/manage/${token}`)).json();
    assert.equal(receipt.calendarState, "not_required");
    assert.equal(receipt.meetingState, "not_required");
    assert.equal(receipt.occurrence.startAt, startAt);
    assert.equal((await visitor.request.get(receipt.icsUrl)).status(), 200);
    await guest.screenshot({ path: evidencePath(`host-calendar-optional-${width}-receipt.png`), fullPage: true });
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "Booking confirmed.", exact: true })).toBeVisible();
    const week = startAt.slice(0, 10);
    const available = async () => (await (await visitor.request.get(origin + `${path}/availability?week=${week}&inviteeTimezone=UTC`)).json()).slots;
    const slots = await available();
    assert.ok(!slots.some(slot => slot.startAt === startAt), "persisted booking removes its occupied time");
    assert.ok(slots.length);
    const selection = { startAt: slots[0].startAt, inviteeTimezone: "UTC" };
    const requests = [visitor.request, competitor.request];
    const nonces = await Promise.all(requests.map(async request => {
      const response = await request.post(origin + path + "/selection", { headers, data: selection });
      assert.equal(response.status(), 201); return (await response.json()).nonce;
    }));
    const results = await Promise.all(requests.map((request, i) => request.post(origin + path + "/confirm", { headers, data: { ...selection, nonce: nonces[i], name: `Independent guest ${i}`, email: `independent-${i}@example.test`, answers: {} } })));
    assert.deepEqual(results.map(response => response.status()).sort(), [201, 409], "independent fresh nonces admit exactly one concurrent claim");
    assert.equal((await results.find(response => response.status() === 409).json()).error.code, "slot_taken");
    const bookings = await (await owner.request.get(origin + "/api/app/bookings")).json();
    assert.equal(bookings.length, 2);
    assert.equal(bookings.filter(booking => booking.occurrence.startAt === selection.startAt).length, 1);
    assert.ok(bookings.every(booking => booking.calendarState === "not_required"));
    const native = await (await owner.request.get(origin + "/__fixtures/status")).json();
    assert.equal(native.bookings.filter(booking => booking.calendar_required === 0).length, 2);
    assert.equal(native.delivery_outbox.filter(job => job.kind.startsWith("calendar_")).length, 0);
    await owner.goto(origin + "/app/bookings");
    await expect(owner.getByRole("button", { name: /Schedule guest/ })).toBeVisible();
    await owner.getByRole("button", { name: /Schedule guest/ }).click();
    await expect(owner.getByText("No connected calendar", { exact: true })).toBeVisible();
    await scan("calendar-optional-host-booking");
    await owner.reload();
    await expect(owner.getByRole("button", { name: /Schedule guest/ })).toBeVisible();
    await guest.getByRole("link", { name: "Manage booking", exact: true }).click();
    await guest.locator("main[aria-busy=false]").waitFor();
    await guest.getByRole("button", { name: "Reschedule booking", exact: true }).click();
    await guest.locator(".pb-slot-button").first().click();
    await guest.getByRole("button", { name: "Confirm reschedule", exact: true }).click();
    await expect(guest.getByText("Your booking has been rescheduled.", { exact: true })).toBeVisible();
    assert.equal((await (await visitor.request.get(origin + `/api/public/manage/${token}`)).json()).calendarState, "not_required");
    guest.once("dialog", dialog => dialog.accept());
    await guest.getByRole("button", { name: "Cancel booking", exact: true }).click();
    await expect(guest.getByText("This booking has been cancelled.", { exact: true })).toBeVisible();
    const afterCancel = await (await owner.request.get(origin + "/__fixtures/status")).json();
    assert.equal(afterCancel.delivery_outbox.filter(job => job.kind.startsWith("calendar_")).length, 0, "schedule-only lifecycle never queues an impossible provider command");
    assert.equal(afterCancel.fixture_activity.filter(item => ["busy", "check", "upsert", "cancel"].includes(item.kind)).length, 0, "no calendar provider is contacted in the absent mode");
        // Google Meet remains a provider capability, even though fixed locations work.
    const source = await (await owner.request.get(origin + `/api/app/event-types/${eventId}`)).json();
    const created = await owner.request.post(origin + "/api/app/event-types", { headers, data: { ...source, slug: "needs-meet", locationType: "google_meet", locationValue: "" } });
    assert.equal(created.status(), 201);
    const meet = await created.json();
    const refused = await owner.request.post(origin + `/api/app/event-types/${meet.id}/publish`, { headers });
    assert.equal(refused.status(), 409);
    assert.ok((await refused.json()).error.details.includes("google_meet_capability"));
    // Once connected, provider errors must close the same previously bookable event.
    await owner.goto(origin + "/app/settings#calendar-connection");
    await owner.getByRole("button", { name: "Connect Google Calendar", exact: true }).click();
    await owner.getByRole("combobox", { name: "Destination calendar", exact: true }).selectOption("synthetic-calendar");
    await owner.getByRole("checkbox", { name: "synthetic-calendar (primary) owner", exact: true }).check();
    await owner.getByRole("button", { name: "Save calendar selection", exact: true }).click();
    await expect(owner.getByText("Calendar selection saved. Check the connection to verify it.", { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Check connection", exact: true }).click();
    await expect(owner.getByText("Calendar check passed.", { exact: true })).toBeVisible();
    await owner.request.post(origin + "/__fixtures/control", { data: { kind: "busy", failure: true } });
    await owner.request.post(origin + "/__fixtures/calendar-health", { data: { healthy: false } });
    const unavailable = await (await visitor.request.get(origin + `${path}/availability?week=${week}&inviteeTimezone=UTC`)).json();
    assert.equal(unavailable.state, "temporarily_unavailable"); assert.deepEqual(unavailable.slots, []);
    assert.equal((await visitor.request.post(origin + path + "/selection", { headers, data: selection })).status(), 503);
    assert.equal((await owner.request.post(origin + `/api/app/event-types/${eventId}/publish`, { headers })).status(), 409);
    await owner.request.post(origin + "/__fixtures/control", { data: { kind: "busy", failure: false } });
    await owner.request.post(origin + "/__fixtures/calendar-health", { data: { healthy: true } });
    assert.ok((await available()).length, "restored provider can serve checked slots again");

  } finally { await visitor.close(); await competitor.close(); }
}
