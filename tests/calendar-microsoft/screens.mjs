import { microsoftScreenRuntime } from "./screen-runtime.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { localMagicLink } from "../auth-client.mjs";

/** Extend the existing host-authoring screen gate; all network reads stay native. */
export async function calendarConnectionScreens({ origin, email, call }) {
  const folder = evidencePath("calendar-provider-screens"); await mkdir(folder, { recursive: true });
  await call("/api/auth/magic-links", { email }, 202);
  const { developmentLink } = await localMagicLink(origin);
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  const owner = await browser.newContext(), shots = [];
  let microsoftScreens;
  try {
    const signedIn = await owner.request.post(origin + "/auth/confirm", { headers: { Origin: origin }, form: { token: new URL(developmentLink).searchParams.get("token") }, maxRedirects: 0 }); assert.equal(signedIn.status(), 303);
    for (const width of [1440, 390]) {
      const page = await owner.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message)); await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/app/settings");
      await expect(page.locator("[data-operator-ready=true]")).toBeVisible();
      const card = page.locator("#calendar-connection"); await card.getByRole("button", { name: /Check connection|Connect Google Calendar/ }).waitFor();
      const disconnect = card.getByRole("button", { name: "Disconnect", exact: true });
      if (await disconnect.count()) { await disconnect.click(); await expect(card.getByRole("button", { name: "Connect Microsoft 365 or Outlook", exact: true })).toBeEnabled(); }
      await expect(card.getByRole("button", { name: "Connect Microsoft 365 or Outlook", exact: true })).toBeEnabled();
      await card.locator("summary").filter({ hasText: "Set up Microsoft 365 or Outlook" }).click();
      await expect(card.getByText(/Missing configuration: MICROSOFT_OAUTH_CLIENT_ID/)).toBeVisible();
      await card.scrollIntoViewIfNeeded(); await page.evaluate(() => globalThis.document.fonts.ready);
      const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id), []);
      assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1));
      const file = `microsoft-connection-${width}.png`; await page.evaluate(() => globalThis.window.scrollTo(0, 0)); await page.screenshot({ path: `${folder}/${file}`, fullPage: true }); shots.push(file);
      assert.deepEqual(errors, [], "calendar settings hydrate without browser errors");
      await page.close();
    }
    microsoftScreens = await microsoftScreenRuntime(browser);
  } finally { await owner.close(); await browser.close(); }
  return { shots, microsoftScreens, widths: [1440, 390], tooltipAudit: "No icon-only controls in the calendar connection card or its shell; every action is visibly labeled." };
}
