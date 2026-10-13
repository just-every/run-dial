import assert from "node:assert/strict";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { auditor, trackPage } from "./audit.mjs";
function inviteeDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = type => parts.find(value => value.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export async function dayPickerJourney(browser, origin, scans, errors) {
  for (const schedule of ["all-day", "working-day"]) {
    assert.equal((await fetch(origin + "/__fixtures/setup", { method: "POST" })).status, 200);
    assert.equal((await fetch(origin + "/__fixtures/schedule", { method: "POST", body: JSON.stringify({ schedule }), headers: { "Content-Type": "application/json" } })).status, 204);
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: "de-DE", timezoneId: "America/New_York" });
      try {
        const page = await context.newPage(); trackPage(page, errors);
        const reads = []; page.on("request", request => { if (request.url().includes("/availability")) reads.push(new URL(request.url())); });
        const initialAvailability = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/book/dial-host/intro/availability" && response.status() === 200);
        await page.goto(origin + "/book/dial-host/intro");
        await page.locator(".pb-slot-button").first().waitFor();
        const icon = page.locator('link[rel="icon"]');
        assert.equal(await icon.count(), 1, "the document declares its favicon");
        const iconResponse = await page.request.get(new URL(await icon.getAttribute("href"), origin).href);
        assert.equal(iconResponse.status(), 200, "favicon is served successfully");
        assert.match(iconResponse.headers()["content-type"], /image\/svg\+xml/);
        const height = await page.evaluate(() => globalThis.document.documentElement.scrollHeight);
        await page.screenshot({ path: evidencePath(`day-picker-${schedule}-${width}.png`), fullPage: true, caret: "initial" });
        scans.push({ width, stage: `picker-height-${schedule}`, height });
        assert.ok(height <= (width === 390 ? 2532 : 1800), `${schedule} ${width} height ${height}`);
        assert.ok(reads.every(url => !url.searchParams.has("inviteeTimezone")), "initial read sends no device zone");
        for (const locator of [page.locator(".pb-event-heading"), page.getByRole("group", { name: "Choose a day", exact: true }), page.getByRole("region", { name: "Suggested times", exact: true })]) {
          const box = await locator.boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height <= (width === 390 ? 844 : 900), `event, days and suggestions appear in first viewport ${JSON.stringify(box)}`);
        }
        assert.equal(await page.locator(".pb-picker-day").first().getAttribute("aria-pressed"), "true", "opens on the first valid invitee day");
        const suggestions = page.getByRole("region", { name: "Suggested times", exact: true });
        assert.ok(await suggestions.locator("button").count() <= 5);
        assert.ok((await suggestions.locator("em").allTextContents()).every(reason => reason.length > 0), "every suggestion explains why in plain words");
        assert.equal(await page.getByRole("button", { name: "Previous week", exact: true }).isDisabled(), true);
        const input = page.getByLabel("View in timezone", { exact: true });
        assert.equal(await input.inputValue(), "America/New_York");
        const expected = await (await initialAvailability).json();
        assert.equal(expected.rankedSlots.length, expected.slots.length);
        assert.deepEqual(expected.recommendations, expected.rankedSlots.slice(0, 5));
        const actual = [];
        const days = page.locator(".pb-picker-day");
        assert.equal(new Set(await days.evaluateAll(elements => elements.map(el => el.dataset.date))).size, await days.count());
        for (let index = 0; index < await days.count(); index++) {
          await days.nth(index).click();
          const selectedDate = await days.nth(index).getAttribute("data-date");
          const rankedDay = expected.rankedSlots.filter(slot => inviteeDate(slot.startAt) === selectedDate).slice(0, 5);
          assert.deepEqual(await suggestions.locator("button").evaluateAll(elements => elements.map(el => el.dataset.startAt)), rankedDay.map(slot => slot.startAt), "suggestions follow native full ranking on every selected day");
          assert.deepEqual(await suggestions.locator("em").allTextContents(), rankedDay.map(slot => slot.reason), "native ranking reasons are unchanged");
          const dayHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight);
          assert.ok(dayHeight <= (width === 390 ? 2532 : 1800), `${schedule} ${width} selected day height ${dayHeight}`);
          actual.push(...await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt)));
        }
        assert.deepEqual(actual.sort(), expected.slots.map(slot => slot.startAt).sort(), "all day choices equal API slots exactly, including suggestions once");
        await auditor(page, width, scans)(`picker-${schedule}`);
      } finally { await context.close(); }
    }
  }
}
