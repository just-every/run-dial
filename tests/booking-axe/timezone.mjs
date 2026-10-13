import assert from "node:assert/strict";
import { trackPage } from "./audit.mjs";
export async function timezoneJourney(browser, origin, errors) {
  const context = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); trackPage(page, errors);
    const reads = []; page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/availability")) reads.push(new URL(request.url())); });
    await page.goto(origin + "/book/dial-host/intro"); await page.locator(".pb-slot-button").first().waitFor();
    const input = page.getByLabel("View in timezone", { exact: true });
    assert.equal(await input.inputValue(), "America/New_York");
    assert.ok(reads.every(url => !url.searchParams.has("inviteeTimezone")));
    const slots = await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt));
    const before = reads.length;
    await input.fill("Mars/Olympus"); await input.press("Tab");
    await page.getByRole("alert").filter({ hasText: "current zone and times are unchanged" }).waitFor();
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert.deepEqual(await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt)), slots);
    assert.equal(reads.length, before, "unknown input makes no availability request");
    await input.fill("new york"); await page.getByRole("option", { name: "America/New_York", exact: true }).waitFor(); await input.press("Enter");
    await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("timezone") === "America/New_York");
    await input.fill("Australia/Brisbane"); await input.press("Enter");
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    await page.locator(".pb-picker-day").nth(1).click();
    const saved = new URL(page.url()).searchParams;
    assert.ok(saved.get("day")); assert.equal(saved.get("timezone"), "Australia/Brisbane");
    await page.getByRole("button", { name: "Device zone", exact: true }).click();
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "America/New_York");
    await page.goBack(); await page.waitForFunction(() => globalThis.document.querySelector('[aria-label="Displayed timezone"] strong')?.textContent === "Australia/Brisbane");
    assert.equal(await page.locator('.pb-picker-day[aria-pressed="true"]').getAttribute("data-date"), saved.get("day"));
    await page.goForward(); await page.waitForFunction(() => globalThis.document.querySelector('[aria-label="Displayed timezone"] strong')?.textContent === "America/New_York");
    await page.goBack(); await page.reload(); await page.locator(".pb-slot-button").first().waitFor();
    assert.equal(await input.inputValue(), "Australia/Brisbane");
    assert.equal(await page.locator('.pb-picker-day[aria-pressed="true"]').getAttribute("data-date"), saved.get("day"));
    assert.ok(reads.some(url => url.searchParams.get("inviteeTimezone") === "Australia/Brisbane"));
  } finally { await context.close(); }
}
