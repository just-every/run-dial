import { setTimeout as delay } from "node:timers/promises";
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
    if (width === 390) { console.log("Waiting one native admission minute between independent operator keyboard viewports."); await delay(60_000); }
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
