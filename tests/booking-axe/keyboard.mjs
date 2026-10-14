import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { timezoneKeyboardJourney } from "./keyboard-timezone.mjs";
import { trackPage } from "./audit.mjs";
import { operatorKeyboardJourney } from "./keyboard-operator.mjs";
import { keyboardControls, button, get } from "./keyboard-controls.mjs";
export async function keyboardJourney(browser, origin, errors, storageState, checks = []) {
  if (storageState) {
    await operatorKeyboardJourney(browser, origin, storageState, checks, errors);
    console.log("Waiting one native admission minute between operator and public keyboard journeys."); await delay(60_000);
  }
  const owner = storageState ? await browser.newContext({ storageState }) : undefined;
  try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: "de-DE", timezoneId: "America/New_York" });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      const keys = keyboardControls(page, width, checks);
      const keyboardActivate = async (target) => keys.activate(target, (await target.getAttribute("aria-label")) || (await target.innerText()));
      const typeField = async (target, value) => keys.type(target, value, (await target.getAttribute("aria-label")) || "Public booking field");
      await page.goto(origin + "/book/dial-host/intro"); await page.locator(".pb-slot-button").first().waitFor();
      await timezoneKeyboardJourney(page, keys, width, checks);
      await keyboardActivate(page.getByRole("button", { name: "Next week", exact: true })); await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      await keyboardActivate(page.locator(".pb-slot-button").first()); await page.getByRole("button", { name: "Confirm booking", exact: true }).waitFor();
      // The details fieldset is disabled and aria-busy until the page hydrates; typing before then is lost.
      await page.locator('.pb-request-fields[aria-busy="false"]').waitFor();
      await keyboardActivate(button(page, "Confirm booking"));
      await page.getByRole("alert").waitFor();
      for (const name of ["Name", "Email"]) {
        const input = page.getByLabel(name, { exact: true });
        assert.equal(await input.getAttribute("aria-invalid"), "true");
        assert.ok(await input.getAttribute("aria-describedby"));
      }
      await keys.screenshot("public-validation");
      await typeField(page.getByLabel("Name", { exact: true }), `Keyboard ${width}`); await typeField(page.getByLabel("Email", { exact: true }), `keyboard${width}@dial.test`); await typeField(page.getByLabel("What would you like to discuss?", { exact: true }), "Keyboard booking and rescheduling");
      await keyboardActivate(page.getByRole("button", { name: "Confirm booking", exact: true })); await page.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
      await keyboardActivate(page.getByRole("link", { name: "Manage booking", exact: true })); await page.locator("main[aria-busy=false]").waitFor();
      await keyboardActivate(page.getByRole("button", { name: "Reschedule booking", exact: true })); await page.locator(".pb-slot-button").first().waitFor();
      await keyboardActivate(page.getByRole("button", { name: "Next week", exact: true })); await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      await keyboardActivate(page.locator(".pb-slot-button").nth(1)); await page.getByRole("button", { name: "Confirm reschedule", exact: true }).waitFor();
      await keyboardActivate(page.getByRole("button", { name: "Confirm reschedule", exact: true })); await page.getByText("Your booking has been rescheduled.", { exact: true }).waitFor();
      const rescheduledStatus = page.getByRole("status").filter({ hasText: "Your booking has been rescheduled." });
      const rescheduleFocused = await rescheduledStatus.evaluate(el => el === globalThis.document.activeElement);
      checks.push({ width, check: "Public reschedule focuses its result after confirmation disappears", passed: rescheduleFocused });
      assert.ok(rescheduleFocused, "public reschedule focuses its announced result");
      assert.ok(await page.getByText(/Currently:/).isVisible(), "keyboard reschedule reaches the verified current booking");
      const readback = async () => (await get(owner ?? page, origin, `/api/app/bookings?query=keyboard${width}%40dial.test`)).find(row => row.inviteeEmail === `keyboard${width}@dial.test`);
      if (owner) { const saved = await readback(); assert.equal(saved.state, "rescheduled"); assert.ok(saved.history.some(row => row.action === "created")); }
      const cancel = button(page, "Cancel booking");
      const before = owner ? await readback() : undefined;
      await keys.native(cancel, "Cancel public cancellation confirmation", "confirm", false);
      await keys.restored(cancel, "Public cancellation dismissed");
      if (owner) assert.deepEqual(await readback(), before);
      await keys.native(cancel, "Confirm public cancellation", "confirm", true);
      await page.getByRole("status").filter({ hasText: "This booking has been cancelled." }).waitFor();
      if (owner) assert.equal((await readback()).state, "cancelled");
      checks.push({ width, check: "Public cancellation focuses its result after controls disappear", passed: await page.getByRole("status").filter({ hasText: "This booking has been cancelled." }).evaluate(el => el === globalThis.document.activeElement) });
      await keys.screenshot("public-cancelled");
      checks.push({ width, flow: "Public validation, booking, reschedule, native cancellation dismiss/confirm and API readback", passed: true });
    } finally { await context.close(); }
  }
  } finally { await owner?.close(); }
}
