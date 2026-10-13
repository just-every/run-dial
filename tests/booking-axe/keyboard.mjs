import assert from "node:assert/strict";
import { keyboardActivate, keyboardFocus, trackPage } from "./audit.mjs";
async function typeField(page, field, text) { await keyboardFocus(page, field); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(text); }
export async function keyboardJourney(browser, origin, errors) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: "de-DE", timezoneId: "America/New_York" });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + "/book/dial-host/intro"); await page.locator(".pb-slot-button").first().waitFor();
      await keyboardActivate(page, page.getByRole("button", { name: "Next week", exact: true })); await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      await keyboardActivate(page, page.locator(".pb-slot-button").first()); await page.getByRole("button", { name: "Confirm booking", exact: true }).waitFor();
      // The details fieldset is disabled and aria-busy until the page hydrates; typing before then is lost.
      await page.locator('.pb-request-fields[aria-busy="false"]').waitFor();
      await typeField(page, page.getByLabel("Name", { exact: true }), `Keyboard ${width}`); await typeField(page, page.getByLabel("Email", { exact: true }), `keyboard${width}@dial.test`); await typeField(page, page.getByLabel("What would you like to discuss?", { exact: true }), "Keyboard booking and rescheduling");
      await keyboardActivate(page, page.getByRole("button", { name: "Confirm booking", exact: true })); await page.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
      await keyboardActivate(page, page.getByRole("link", { name: "Manage booking", exact: true })); await page.locator("main[aria-busy=false]").waitFor();
      await keyboardActivate(page, page.getByRole("button", { name: "Reschedule booking", exact: true })); await page.locator(".pb-slot-button").first().waitFor();
      await keyboardActivate(page, page.getByRole("button", { name: "Next week", exact: true })); await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      await keyboardActivate(page, page.locator(".pb-slot-button").nth(1)); await page.getByRole("button", { name: "Confirm reschedule", exact: true }).waitFor();
      await keyboardActivate(page, page.getByRole("button", { name: "Confirm reschedule", exact: true })); await page.getByText("Your booking has been rescheduled.", { exact: true }).waitFor();
      assert.ok(await page.getByText(/Currently:/).isVisible(), "keyboard reschedule reaches the verified current booking");
    } finally { await context.close(); }
  }
}
