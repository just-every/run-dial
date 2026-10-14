import assert from "node:assert/strict";
import { button, field, get } from "./keyboard-controls.mjs";

export async function bookingFilterKeyboardJourney(page, origin, width, keys, checks, booking) {
  const search = field(page, "Search invitee name or email");
  await page.locator('fieldset[aria-busy="false"]').filter({ has: search }).waitFor();
  await keys.type(search, booking.inviteeEmail, "Search booking email");
  try { await page.waitForFunction(email => new URL(globalThis.location.href).searchParams.get("query") === email, booking.inviteeEmail); }
  catch (error) {
    const state = { expected: booking.inviteeEmail, input: await search.inputValue(), query: new URL(page.url()).searchParams.get("query"), focused: await search.evaluate(el => el === globalThis.document.activeElement) };
    checks.push({ width, check: "Search keyboard input and URL agree", passed: false, state });
    await keys.screenshot("search-input-failure");
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  }
  await page.getByRole("heading", { name: booking.inviteeName, exact: true }).waitFor();
  const state = page.getByRole("radiogroup", { name: "Lifecycle state", exact: true });
  await keys.focus(state.getByRole("radio", { name: "All states", exact: true }), "Booking lifecycle radio group");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.getByRole("heading", { name: "No bookings match these filters", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("state"), "cancelled");
  assert.equal((await get(page, origin, `/api/app/bookings?query=${encodeURIComponent(booking.inviteeEmail)}&state=cancelled`)).length, 0);
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
  await page.getByRole("heading", { name: booking.inviteeName, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("state"), "confirmed");
  await keys.select(field(page, "Start time"), "past", "Booking temporal filter");
  await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("time") === "past");
  await page.getByRole("heading", { name: booking.inviteeName, exact: true }).waitFor();
  const rows = await get(page, origin, `/api/app/bookings?query=${encodeURIComponent(booking.inviteeEmail)}&state=confirmed&time=past`);
  assert.deepEqual(rows.map(row => row.id), [booking.id]);
  await keys.select(field(page, "Event type"), booking.eventTypeId, "Booking event filter");
  await page.waitForFunction(id => new URL(globalThis.location.href).searchParams.get("eventTypeId") === id, booking.eventTypeId);
  await keys.screenshot("booking-filters");
  await keys.activate(button(page, "Clear filters"), "Clear booking filters");
  await page.waitForFunction(() => !new URL(globalThis.location.href).searchParams.get("query"));
  await keys.type(search, booking.inviteeEmail, "Restore focused booking search");
  await page.getByRole("heading", { name: booking.inviteeName, exact: true }).waitFor();
  checks.push({ width, flow: "Booking search, lifecycle arrow-key selection, time/event native selects and clear filters with API readback", passed: true });
}
