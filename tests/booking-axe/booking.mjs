import assert from "node:assert/strict";
import { auditor, keyboardActivate, trackPage } from "./audit.mjs";
import { linkContrast } from "./link-contrast.mjs";
export async function bookingJourney(browser, origin, scans, errors, widths = [1440, 390]) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, locale: "de-DE", timezoneId: "America/New_York" });
    try {
      const page = await context.newPage(); trackPage(page, errors); const audit = auditor(page, width, scans);
      await page.goto(origin + "/"); await page.locator(".door-card .btn").waitFor(); await audit("home");
      await page.goto(origin + "/book/dial-host"); await page.locator(".pb-event-card").first().waitFor(); await audit("profile");
      await page.goto(origin + "/book/dial-host/intro"); await page.locator(".pb-slot-button").first().waitFor();
      if (width === 390) { const menu = page.getByRole("button", { name: "Menu", exact: true }); await menu.click(); await page.keyboard.press("Escape"); assert.equal(await menu.getAttribute("aria-expanded"), "false"); assert.ok(await menu.evaluate(el => el === globalThis.document.activeElement)); }
      const zone = page.getByLabel("View in timezone", { exact: true }); await zone.fill("Australia/Brisbane"); await zone.press("Enter");
      await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Next week", exact: true }).click(); await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" }); await audit("selection");
      await keyboardActivate(page, page.locator(".pb-slot-button").first()); await page.getByRole("button", { name: "Confirm booking", exact: true }).waitFor();
      let confirmations = 0; page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/confirm")) confirmations++; });
      await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
      assert.equal(confirmations, 0, "invalid details make no confirmation request and consume no nonce");
      for (const field of [page.getByLabel("Name", { exact: true }), page.getByLabel("Email", { exact: true }), page.getByLabel("What would you like to discuss?", { exact: true })]) {
        assert.equal(await field.getAttribute("aria-invalid"), "true"); const message = await field.getAttribute("aria-describedby"); assert.ok(message); assert.ok(await page.locator(`[id="${message}"]`).isVisible());
      }
      assert.ok(await page.getByText("Fields marked * are required.", { exact: true }).isVisible()); await audit("details-invalid");
      await page.getByLabel("Name", { exact: true }).fill(`Axe ${width}`); await page.getByLabel("Email", { exact: true }).fill(`axe${width}@dial.test`); await page.getByLabel("What would you like to discuss?", { exact: true }).fill("Accessibility journey"); await audit("details");
      await page.getByRole("button", { name: "Confirm booking", exact: true }).click(); await page.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
      await page.getByText(/Your joining link will arrive by email/).waitFor(); await audit("receipt");
      await linkContrast(page.getByRole("link", { name: "Add to calendar", exact: true })); await linkContrast(page.getByRole("link", { name: "Manage booking", exact: true }));
      for (let i = 0; i < 2; i++) assert.equal((await page.request.post(origin + "/__fixtures/deliver", { data: {} })).status(), 200);
      await page.reload(); await page.getByRole("link", { name: "Join session", exact: true }).waitFor(); await linkContrast(page.getByRole("link", { name: "Join session", exact: true })); await audit("receipt-ready");
      await page.getByRole("link", { name: "Manage booking", exact: true }).click(); await page.locator("main[aria-busy=false]").waitFor(); await audit("manage");
      const token = new URL(page.url()).pathname.split("/").at(-1);
      const old = await (await page.request.get(`${origin}/api/public/manage/${token}`)).json(); assert.equal(old.inviteeTimezone, "Australia/Brisbane");
      await keyboardActivate(page, page.getByRole("button", { name: "Reschedule booking", exact: true })); await page.locator(".pb-slot-button").first().waitFor();
      assert.equal(await page.getByLabel("View in timezone", { exact: true }).inputValue(), "America/New_York");
      await page.getByLabel("View in timezone", { exact: true }).fill("Australia/Brisbane");
      await page.getByLabel("View in timezone", { exact: true }).press("Enter");
      await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
      assert.ok(await page.getByText(/Currently:.*Australia\/Brisbane/).first().isVisible());
      assert.equal(await page.getByRole("button", { name: "Confirm reschedule", exact: true }).count(), 0, "no confirm before choosing an offered slot"); await audit("manage-error");
      const endpoint = await (await page.request.get(`${origin}/api/public/manage/${token}/reschedule/availability?inviteeTimezone=Australia%2FBrisbane`)).json(); assert.ok(endpoint.slots.length);
      const actual = []; const days = page.locator(".pb-picker-day");
      for (let day = 0; day < await days.count(); day++) { await days.nth(day).click(); actual.push(...await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt))); }
      assert.deepEqual(actual.sort(), endpoint.slots.map(slot => slot.startAt).sort(), "Brisbane picker offers exactly native engine slots, in a New York browser");
      await page.locator(".pb-slot-button").first().click(); await page.getByRole("button", { name: "Confirm reschedule", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Confirm reschedule", exact: true }).count(), 1);
      assert.equal((await (await page.request.get(`${origin}/api/public/manage/${token}`)).json()).occurrence.startAt, old.occurrence.startAt, "old slot is held until Confirm commits"); await audit("reschedule-review");
      await page.getByRole("button", { name: "Confirm reschedule", exact: true }).click(); await page.getByText("Your booking has been rescheduled.", { exact: true }).waitFor(); await audit("rescheduled");
      page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Cancel booking", exact: true }).click(); assert.notEqual((await (await page.request.get(`${origin}/api/public/manage/${token}`)).json()).state, "cancelled");
      page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Cancel booking", exact: true }).click(); await page.getByText("This booking has been cancelled.", { exact: true }).waitFor();
      await page.reload(); await page.locator("main[aria-busy=false]").waitFor(); assert.equal(await page.getByRole("button", { name: "Cancel booking", exact: true }).count(), 0); assert.equal(await page.getByRole("button", { name: "Reschedule booking", exact: true }).count(), 0); assert.equal(await page.locator("textarea, .pb-slot-button").count(), 0); await audit("cancelled");
    } finally { await context.close(); }
  }
}
