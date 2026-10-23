import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { completeEmptyWorkspace } from "../booking-axe/first-run-fixture.mjs";

export async function microsoftScreens({ browser, origin }) {
  const folder = evidencePath("calendar-provider-screens"); await mkdir(folder, { recursive: true });
  const owner = await browser.newContext(), shots = [], headers = { Origin: origin };
  const json = async (response, status = 200) => { assert.equal(response.status(), status, await response.text()); return response.json(); };
  try {
    assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "synthetic-dial-1617-at-least-thirty-two-characters", displayName: "Synthetic Dial 1640", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
    await completeEmptyWorkspace(owner, origin);
    const event = await json(await owner.request.post(origin + "/api/app/event-types", { headers, data: { slug: "synthetic-dial-1641", title: "Synthetic Dial 1641", description: "A meeting with a chosen location.", durationMinutes: 30, color: "#176b5a", locationType: "microsoft_teams", locationLabel: "Microsoft Teams", locationValue: "", locations: [{ id: "synthetic-dial-1642", type: "microsoft_teams", label: "Microsoft Teams", value: "" }, { id: "synthetic-dial-1643", type: "phone", label: "Call the host", value: "+12025550164" }], listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) } }), 201);
    const refused = await json(await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`, { headers, data: {} }), 409); assert.ok(refused.error.details.includes("microsoft_teams_capability"));
    const start = await owner.request.get(origin + "/api/app/calendar/oauth/start?provider=microsoft", { maxRedirects: 0 }); assert.equal(start.status(), 302);
    const state = new URL(start.headers().location).searchParams.get("state"); assert.ok(state);
    assert.equal((await owner.request.get(origin + "/api/calendar/oauth/callback?" + new URLSearchParams({ state, code: "synthetic-dial-1644" }), { maxRedirects: 0 })).status(), 302);
    await json(await owner.request.put(origin + "/api/app/calendar/selection", { headers, data: { destinationCalendarId: "synthetic-dial-1602", conflictCalendarIds: ["synthetic-dial-1604"] } }));
    await json(await owner.request.post(origin + "/api/app/calendar/check", { headers, data: {} }));
    await json(await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`, { headers, data: {} }));
    for (const width of [1440, 390]) {
      const page = await owner.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message)); await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/app/settings"); await expect(page.locator("[data-operator-ready=true]")).toBeVisible(); const card = page.locator("#calendar-connection"); await expect(card.getByRole("heading", { name: "Microsoft 365 and Outlook" })).toBeVisible(); await expect(card.getByRole("button", { name: "Reconnect account" })).toBeEnabled(); await capture(page, width, "microsoft-connected");
      await page.goto(`${origin}/app/event-types/${event.id}`); await expect(page.locator("[data-operator-ready=true]")).toBeVisible(); const kind = page.getByRole("combobox", { name: "Location kind", exact: true }).first(); await expect(kind).toBeEnabled(); await expect(kind.locator('option[value="microsoft_teams"]')).toBeEnabled(); assert.equal(await kind.inputValue(), "microsoft_teams"); await capture(page, width, "teams-location");
      assert.deepEqual(errors, [], "native calendar and location screens hydrate cleanly"); await page.close();
    }
    return { shots, widths: [1440, 390], tooltipAudit: "Calendar and location actions are visibly labeled; no icon-only controls." };
  } finally { await owner.close(); }
  async function capture(page, width, name) {
    await page.evaluate(() => globalThis.document.fonts.ready); const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id), []);
    assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1)); await page.evaluate(() => globalThis.window.scrollTo(0, 0));
    const file = `${name}-${width}.png`; await page.screenshot({ path: `${folder}/${file}`, fullPage: true }); shots.push(file);
  }
}
