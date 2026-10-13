import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

/** `rer dev` opens signed in: following its RER_OPEN link lands the owner on /setup with a real session, no mail and no password. */
export async function devIdentityJourney(server, origin, { width, email, onSignedIn }) {
  assert.equal(server.signedInAs, email, "rer dev names the identity it opens");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await context.newPage();
    await page.goto(server.openUrl);
    await page.waitForURL(origin + "/setup");
    assert.equal(new URL(page.url()).hash, "", "the key leaves the address bar");
    const session = await page.request.get(origin + "/api/app/session");
    assert.equal(session.status(), 200);
    assert.equal((await session.json()).operator.email, email);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "no horizontal overflow");
    await onSignedIn(page);
  } finally { await browser.close(); }
}
