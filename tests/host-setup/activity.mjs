import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { overviewHealth } from "./health.mjs";

export async function activityJourney(page, origin, eventId, scan) {
  const headers = { Origin: origin };
  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const slots = await (await page.request.get(origin + `/api/public/book/fresh-host/first-event/availability?week=${week}&inviteeTimezone=UTC`)).json();
  assert.ok(slots.slots.length);
  const created = await page.request.post(origin + "/api/app/bookings", { headers, data: { eventTypeId: eventId, startAt: slots.slots[0].startAt, inviteeTimezone: "America/New_York", name: "Newest booking", email: "booking@dial.test", answers: {}, overrideNoticeAndHorizon: false } });
  assert.equal(created.status(), 201);
  const composition = { inviteeName: "Newest request", inviteeEmail: "request@dial.test", inviteeTimezone: "UTC", note: "A different time", windows: [{ date: week, startMinute: 600, endMinute: 660 }] };
  const review = await page.request.post(origin + "/api/public/events/fresh-host/first-event/request/review", { headers, data: composition }); assert.equal(review.status(), 201);
  const { nonce } = await review.json();
  assert.equal((await page.request.post(origin + "/api/public/events/fresh-host/first-event/request?nonce=" + encodeURIComponent(nonce), { headers, data: composition })).status(), 201);
  await page.goto(origin + "/app"); await expect(page.getByText("1 booking", { exact: true })).toBeVisible(); await expect(page.getByText("1 request", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Latest bookings" })).toContainText("Newest booking"); await expect(page.getByRole("list", { name: "Latest requests" })).toContainText("Newest request"); await overviewHealth(page, origin, { calendar: "healthy", mail: "healthy" }); await scan("activity");
  for (let i = 0; i < 2; i++) assert.equal((await page.request.post(origin + "/__fixtures/deliver", { data: {} })).status(), 200);
  const native = await (await page.request.get(origin + "/__fixtures/status")).json();
  const booking = native.bookings[0], occurrence = native.booking_occurrences.find(row => row.id === booking.current_occurrence_id);
  assert.ok(booking.calendar_provider_event_id);
  assert.equal((await page.request.post(origin + "/__fixtures/change", { data: { kind: "changed", bookingId: booking.id, occurrenceId: occurrence.id, providerEventId: booking.calendar_provider_event_id, updatedAt: new Date(Date.now() + 5000).toISOString(), startAt: new Date(Date.parse(occurrence.start_at) + 300000).toISOString(), endAt: new Date(Date.parse(occurrence.end_at) + 300000).toISOString(), location: "External edited room" } })).status(), 204);
  await page.goto(origin + "/app/bookings");
  const opener = page.getByRole("button", { name: "Review calendar conflicts", exact: true }); await opener.click();
  const dialog = page.getByRole("dialog", { name: "Calendar conflicts", exact: true }); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(dialog).toContainText("External edited room"); await expect(dialog).toContainText("America/New_York"); await expect(dialog).toContainText("UTC"); await expect(dialog.getByRole("button", { name: "Restore booking time", exact: true })).toBeEnabled(); await expect(dialog.getByRole("button", { name: "Cancel booking instead", exact: true })).toBeEnabled(); await scan("conflict-dialog");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  const filter = page.getByRole("radiogroup", { name: "Lifecycle state", exact: true });
  await filter.getByRole("radio", { name: "Cancelled", exact: true }).check(); await expect(page.getByRole("heading", { name: "No bookings match these filters", exact: true })).toBeVisible();
  await filter.getByRole("radio", { name: "Confirmed", exact: true }).check(); await expect(page.getByRole("button", { name: /Newest booking/ })).toBeVisible();
  await page.request.post(origin + "/__host/imported");
  await page.goto(origin + "/app"); await expect(page.getByText("reauthorization required", { exact: true })).toBeVisible(); await expect(page.getByText("mail check required", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Google setup guide", exact: true })).toHaveAttribute("href", "/app/settings#calendar-connection");
  await overviewHealth(page, origin, { calendar: "unhealthy", mail: "unhealthy" }); await scan("imported-status");
}
