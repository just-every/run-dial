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
    await input.click();
    const choices = page.getByRole("listbox", { name: "Matching timezones", exact: true });
    assert.equal(await choices.getByRole("option").first().textContent(), "America/New_York", "the browser zone is the first choice");
    await input.fill("Mars/Olympus");
    const empty = page.getByRole("status").filter({ hasText: "No matching timezones" }); await empty.waitFor();
    assert.equal(await choices.getByRole("option").count(), 0);
    assert.equal(await input.getAttribute("aria-describedby"), await empty.getAttribute("id"));
    await input.press("Enter"); await input.press("Tab");
    assert.equal(await input.inputValue(), "America/New_York", "unmatched text never commits");
    await input.fill("Australia/Brisbane"); await input.press("Tab");
    assert.equal(await input.inputValue(), "America/New_York", "typing even a supported zone requires selecting a result");
    assert.deepEqual(await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt)), slots);
    assert.equal(reads.length, before, "uncommitted searches make no availability request");
    await input.fill("new york"); await page.getByRole("option", { name: "America/New_York", exact: true }).waitFor(); await input.press("Enter");
    await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("timezone") === "America/New_York");
    await input.fill("Australia/Brisbane"); await input.press("Enter");
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    await page.locator(".pb-picker-day").nth(1).click();
    const saved = new URL(page.url()).searchParams;
    assert.ok(saved.get("day")); assert.equal(saved.get("timezone"), "Australia/Brisbane");
    await input.click();
    assert.equal(await choices.getByRole("option").first().textContent(), "America/New_York", "reopening shows all choices with the browser zone first");
    await choices.getByRole("option").first().click();
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "America/New_York");
    await page.goBack(); await page.waitForFunction(() => globalThis.document.querySelector('input[aria-label="View in timezone"]')?.value === "Australia/Brisbane");
    assert.equal(await page.locator('.pb-picker-day[aria-pressed="true"]').getAttribute("data-date"), saved.get("day"));
    await page.goForward(); await page.waitForFunction(() => globalThis.document.querySelector('input[aria-label="View in timezone"]')?.value === "America/New_York");
    await page.goBack(); await page.reload(); await page.locator(".pb-slot-button").first().waitFor();
    assert.equal(await input.inputValue(), "Australia/Brisbane");
    assert.equal(await page.locator('.pb-picker-day[aria-pressed="true"]').getAttribute("data-date"), saved.get("day"));
    assert.ok(reads.some(url => url.searchParams.get("inviteeTimezone") === "Australia/Brisbane"));
  } finally { await context.close(); }
}
