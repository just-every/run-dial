import assert from "node:assert/strict";
import { auditor, keyboardActivate, trackPage } from "./audit.mjs";

export async function requestOnlyJourney(browser, origin, scans, errors, storageState) {
  const owner = await browser.newContext({ storageState });
  try {
    const post = async (path, body, expected = 200) => {
      const response = await owner.request.post(origin + path, { data: body, headers: { Origin: origin }, maxRedirects: 0 });
      assert.equal(response.status(), expected, await response.text()); return response;
    };
    assert.equal((await (await owner.request.get(origin + "/api/app/calendar/connection")).json()).state, "disconnected");
    const savedProfile = await owner.request.patch(origin + "/api/app/profile", { data: { handle: "requests-host", name: "Request Host", title: "Advisor", biography: "Share a future window.", timezone: "UTC", focusAreas: [], socialProof: [] }, headers: { Origin: origin } });
    assert.equal(savedProfile.status(), 200, await savedProfile.text());
    const response = await post("/api/app/event-types", { slug: "requests", title: "Request a conversation", description: "Share a future window.", durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [] }, 201);
    const event = await response.json();
    await post(`/api/app/event-types/${event.id}/publish`, {}, 409);
    await post(`/api/app/event-types/${event.id}/open-requests`, {});
    const profile = await (await owner.request.get(origin + "/api/app/profile")).json();
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, timezoneId: "UTC" });
      try {
        const page = await context.newPage(); trackPage(page, errors);
        const audit = auditor(page, width, scans);
        await page.goto(`${origin}/book/${profile.handle}/requests`);
        await page.getByRole("heading", { name: `Request a time with ${profile.name}.`, exact: true }).waitFor();
        assert.equal(await page.locator(".pb-slot-button").count(), 0);
        assert.equal(await page.getByRole("link", { name: /View event types|Back to availability/ }).count(), 0);
        assert.equal(await page.getByRole("navigation", { name: "Booking progress" }).count(), 0);
        await audit("request-only-page");
        await keyboardActivate(page, page.getByRole("link", { name: "Send another request", exact: true }));
        await page.getByRole("button", { name: "Review request", exact: true }).waitFor();
        await keyboardActivate(page, page.locator(".pb-day-choice").last(), "Space");
        assert.equal(await page.locator(".pb-day-choice").last().getAttribute("aria-pressed"), "true");
        const dates = await page.locator(".pb-day-choice").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
        assert.equal(dates.length, 10);
        assert.ok(dates.every(box => box.width >= 44 && box.height >= 44), "date choices provide distinct usable touch targets");
        await page.getByLabel("Start", { exact: true }).fill("10:00");
        await page.getByLabel("End", { exact: true }).fill("09:00");
        await page.getByLabel("Name", { exact: true }).fill(`Request-only guest ${width}`);
        await page.getByLabel("Email", { exact: true }).fill(`requests${width}@dial.test`);
        assert.equal(await page.getByRole("link", { name: /View event types|Back to availability/ }).count(), 0);
        await audit("request-compose");
        await keyboardActivate(page, page.getByRole("button", { name: "Review request", exact: true }));
        await page.getByRole("status").filter({ hasText: "Each time window needs an end after its start." }).waitFor();
        assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), `Request-only guest ${width}`);
        await audit("request-compose-error");
        await page.getByLabel("End", { exact: true }).fill("11:00");
        await keyboardActivate(page, page.getByRole("button", { name: "Review request", exact: true }));
        await page.getByRole("heading", { name: "Review your request.", exact: true }).waitFor();
        const values = await page.locator(".pb-request-review dd").evaluateAll(elements => elements.map(el => ({ left: el.getBoundingClientRect().left, value: el.querySelector("li")?.getBoundingClientRect().left })));
        const preferred = values.find(value => value.value !== undefined);
        assert.ok(preferred && Math.abs(preferred.left - preferred.value) <= 1, "Preferred windows align with other receipt values");
        await audit("request-only-review");
        await keyboardActivate(page, page.getByRole("button", { name: "Send request", exact: true }));
        await page.getByRole("heading", { name: "Request received.", exact: true }).waitFor();
        assert.match(await page.getByRole("status").innerText(), /Acknowledgement email is queued/);
        await audit("request-only-receipt");
        assert.equal((await page.request.post(origin + "/__fixtures/deliver", { data: {} })).status(), 200);
        await page.getByRole("status").filter({ hasText: "An acknowledgement email was sent to your email address." }).waitFor();
        await audit("request-only-email-sent");
        await keyboardActivate(page, page.getByRole("button", { name: "Send another request", exact: true }));
        await page.getByRole("button", { name: "Review request", exact: true }).waitFor();
        assert.equal(await page.getByRole("link", { name: /View event types|Back to availability/ }).count(), 0);
        assert.equal((await context.cookies()).length, 0, "the request journey is sessionless");
      } finally { await context.close(); }
    }
    assert.equal((await (await owner.request.get(origin + "/api/app/calendar/connection")).json()).state, "disconnected");
    assert.equal((await (await owner.request.get(origin + "/api/app/availability-requests")).json()).length, 2);
  } finally { await owner.close(); }
}
