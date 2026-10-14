import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { button, keyboardControls, get } from "./keyboard-controls.mjs";
import { eventKeyboardJourney } from "./keyboard-events.mjs";
import { settingsKeyboardJourney } from "./keyboard-settings.mjs";
import { bookingFilterKeyboardJourney } from "./keyboard-filters.mjs";
import { seedConflict, bookingKeyboardJourney } from "./keyboard-bookings.mjs";
import { trackPage } from "./audit.mjs";

export async function operatorKeyboardJourney(browser, origin, storageState, checks, errors) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 900 }, locale: "en-US", timezoneId: "UTC" });
    const page = await context.newPage(); trackPage(page, errors);
    const keys = keyboardControls(page, width, checks);
    try {
      const fixture = await (await context.request.post(origin + "/__fixtures/setup")).json();
      const event = await get(page, origin, `/api/app/event-types/${fixture.eventId}`);
      const date = new Date(Date.now() + (width === 390 ? 30 : 20) * 86400000).toISOString().slice(0, 10);
      const available = await get(page, origin, `/api/public/book/dial-host/intro/availability?week=${date}`);
      const response = await context.request.post(origin + "/api/app/bookings", { headers: { Origin: origin }, data: { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: available.slots[0].startAt, inviteeTimezone: "UTC", name: `Keyboard operator ${width}`, email: `keyboard-operator-${width}@dial.test`, answers: Object.fromEntries(event.questions.map(q => [q.key, "Keyboard accessibility"])), overrideNoticeAndHorizon: false } });
      assert.equal(response.status(), 201); const booking = await response.json();
      await seedConflict(page, origin, booking);
      assert.equal((await context.request.post(origin + "/__fixtures/booking-ended", { data: { id: booking.id } })).status(), 204);
      await page.goto(origin + "/app");
      await keys.navigate("Bookings");
      await bookingFilterKeyboardJourney(page, origin, width, keys, checks, booking);
      const attendance = button(page, "Mark attended"); await attendance.waitFor();
      const before = await get(page, origin, `/api/app/bookings/${booking.id}`);
      const attendanceWrites = [];
      page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(`/bookings/${booking.id}/attendance`)) attendanceWrites.push(request.url()); });
      await keys.native(attendance, "Cancel attendance prompt", "prompt", false);
      // Let the UI finish its handler and any issued mutation before readback.
      await page.waitForLoadState("networkidle");
      const after = await get(page, origin, `/api/app/bookings/${booking.id}`);
      checks.push({ width, stage: "attendance-cancel-readback", attendanceWrites: attendanceWrites.length, beforeAttendance: before.attendance, afterAttendance: after.attendance, beforeHistoryLength: before.history.length, afterHistoryLength: after.history.length, passed: attendanceWrites.length === 0 && JSON.stringify(before.attendance) === JSON.stringify(after.attendance) });
      assert.equal(attendanceWrites.length, 0, "Cancelled attendance issues no mutation request");
      assert.deepEqual(after.attendance, before.attendance, "Cancelling attendance prompt does not mark attendance");
      assert.deepEqual(after.history, before.history, "Cancelling attendance prompt adds no history");
      await keys.restored(attendance, "Cancelled attendance");
      await keys.screenshot("attendance-cancelled");
      await bookingKeyboardJourney(page, origin, width, keys, checks, booking);
      await eventKeyboardJourney(page, origin, width, keys, checks, errors);
      await settingsKeyboardJourney(page, origin, width, keys, checks, booking, errors);
    } catch (error) {
      checks.push({ width, passed: false, error: error.message, accessibilitySnapshot: await page.locator("body").ariaSnapshot() });
      await keys.screenshot("operator-failure");
      throw error;
    } finally { await context.close(); }
  }
}
