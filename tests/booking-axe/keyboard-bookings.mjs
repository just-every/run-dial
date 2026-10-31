import assert from "node:assert/strict";
import { button, get, mutation } from "./keyboard-controls.mjs";

// Provider-only fixture setup supplies a genuine native conflict, so the
// production dialog can be opened and closed entirely through keyboard input.
export async function seedConflict(page, origin, booking) {
  for (let i = 0; i < 2; i++) assert.equal((await page.request.post(origin + "/__fixtures/deliver", { data: {} })).status(), 200);
  const native = await get(page, origin, "/__fixtures/status");
  const row = native.bookings.find(row => row.id === booking.id);
  const occurrence = native.booking_occurrences.find(occurrence => occurrence.id === row.current_occurrence_id);
  assert.ok(row.calendar_provider_event_id);
  assert.equal((await page.request.post(origin + "/__fixtures/change", { data: { kind: "changed", bookingId: booking.id, occurrenceId: occurrence.id, providerEventId: row.calendar_provider_event_id, updatedAt: new Date(Date.now() + 5000).toISOString(), startAt: new Date(Date.parse(occurrence.start_at) + 300000).toISOString(), endAt: new Date(Date.parse(occurrence.end_at) + 300000).toISOString(), location: "External keyboard fixture room" } })).status(), 204);
}

export async function bookingKeyboardJourney(page, origin, width, keys, checks, booking) {
  const more = page.locator("details.dial-more").first();
  if (await more.getAttribute("open") === null) await keys.activate(more.locator("summary"), "Open more booking actions");
  const before = await get(page, origin, `/api/app/bookings/${booking.id}`);
  const opener = button(page, "Review calendar conflicts");
  await keys.activate(opener, "Open native DOM calendar conflict dialog");
  const dialog = page.getByRole("dialog", { name: "Calendar conflicts", exact: true }); await dialog.waitFor();
  assert.equal(await dialog.evaluate(el => el.matches(":modal")), true);
  assert.ok(await button(dialog, "Close").evaluate(el => el === globalThis.document.activeElement), "dialog focuses its Close button");
  // Traverse beyond both ends. DOM inspection only observes focus; it never
  // calls focus(), clicks, or changes the state under test.
  for (const key of ["Tab", "Shift+Tab"]) {
    const count = await dialog.locator("button").count();
    for (let i = 0; i < count + 2; i++) {
      await page.keyboard.press(key);
      const focus = await dialog.evaluate(el => ({ contained: el.contains(globalThis.document.activeElement), tag: globalThis.document.activeElement?.tagName, label: globalThis.document.activeElement?.getAttribute("aria-label") || globalThis.document.activeElement?.textContent?.slice(0, 80) }));
      checks.push({ width, check: `Native DOM dialog ${key} containment ${i + 1}`, passed: focus.contained, focus });
      if (!focus.contained) await keys.screenshot("dialog-focus-escaped");
      assert.ok(focus.contained, `native DOM dialog contains ${key} focus: ${JSON.stringify(focus)}`);
    }
  }
  await keys.focus(button(dialog, "Restore booking time"), "Dialog restore action");
  await keys.screenshot("dialog-focus-trap");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  await keys.restored(opener, "Native DOM dialog Escape");
  assert.deepEqual(await get(page, origin, `/api/app/bookings/${booking.id}`), before, "Escape dismisses without altering the booking");
  await keys.activate(opener, "Reopen native DOM dialog");
  await keys.activate(button(dialog, "Close"), "Close native DOM dialog"); await dialog.waitFor({ state: "hidden" });
  await keys.restored(opener, "Native DOM dialog Close");
  const effects = async () => { const native = await get(page, origin, "/__fixtures/status"); return { commands: native.delivery_outbox.filter(row => row.booking_id === booking.id).map(row => row.id), event: native.fixture_events.find(row => row.booking_id === booking.id) }; };
  const effectsBefore = await effects(), markedFrom = Date.now();
  await mutation(page, `/api/app/bookings/${booking.id}/attendance`, () => keys.activate(button(page, "Mark attended"), "Mark attended"));
  await page.locator("dd", { hasText: /^Attended$/ }).waitFor();
  checks.push({ width, check: "Attendance confirmation leaves logical focus on its result", passed: await page.getByRole("status", { name: "Booking update" }).evaluate(el => el === globalThis.document.activeElement) });
  const attended = await get(page, origin, `/api/app/bookings/${booking.id}`);
  assert.equal(attended.attendance.status, "attended"); assert.equal(attended.attendance.note, "");
  // BOOK-011: the mark records its operator and time, keeps the lifecycle state, and queues no mail or calendar command.
  assert.equal(attended.attendance.operatorId, (await get(page, origin, "/api/app/operators")).currentOperatorId, "BOOK-011: the mark records the signed-in operator");
  assert.ok(Date.parse(attended.attendance.markedAt) >= markedFrom - 1000 && Date.parse(attended.attendance.markedAt) <= Date.now() + 1000, "BOOK-011: the mark records its time");
  assert.ok(attended.history.some(entry => entry.action === "attendance_marked" && entry.actorType === "operator" && entry.actorId === attended.attendance.operatorId), "BOOK-011: the booking record shows the mark");
  assert.equal(attended.state, before.state, "BOOK-011: attendance changes no lifecycle state");
  assert.deepEqual(await effects(), effectsBefore, "BOOK-011: attendance sends nothing and changes no calendar event");
  const cancel = button(page, "Cancel booking");
  await keys.native(cancel, "Dismiss booking cancellation prompt", "prompt", false);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(await get(page, origin, `/api/app/bookings/${booking.id}`), attended);
  await keys.restored(cancel, "Cancelled booking cancellation");
  await mutation(page, `/api/app/bookings/${booking.id}/cancel`, () => keys.native(cancel, "Confirm booking cancellation", "prompt", true, "Keyboard cancellation note"));
  await page.getByRole("status", { name: "Booking update" }).filter({ hasText: "Booking cancelled" }).waitFor();
  await page.getByText("Loading bookings…", { exact: true }).waitFor({ state: "hidden" });
  checks.push({ width, check: "Booking cancellation focuses its result after its action disappears", passed: await page.getByRole("status", { name: "Booking update" }).evaluate(el => el === globalThis.document.activeElement) });
  const cancelled = await get(page, origin, `/api/app/bookings/${booking.id}`);
  assert.equal(cancelled.state, "cancelled"); assert.ok(cancelled.history.some(entry => entry.action === "cancelled" && entry.reason === "Keyboard cancellation note"));
  await keys.screenshot("booking-cancelled");
  checks.push({ width, flow: "Attendance marking, booking cancellation prompt dismissal/confirmation, native DOM modal Tab/Shift+Tab trap, real Escape and Close restoration, API readback", passed: true });
}
