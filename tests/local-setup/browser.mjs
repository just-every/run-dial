import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertNoAxeViolations } from "./browser-diagnostics.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";

/** Real local owner flow, after setup or restore, through the printed one-click link. */
export async function browserJourney(origin, { email, width, openUrl, onSignedIn, completed = false }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto(openUrl);
    await page.waitForURL(origin + (completed ? "/app" : "/setup"));
    const session = await page.request.get(origin + "/api/app/session");
    assert.equal(session.status(), 200);
    assert.equal((await session.json()).operator.email, email);
    await onSignedIn?.(page, () => {});
    assertNoAxeViolations((await new AxeBuilder({ page }).analyze()).violations);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    await page.screenshot({ path: evidencePath(`local-signed-in-${width}.png`), fullPage: true });
  } finally { await browser.close(); }
}
