import assert from "node:assert/strict";
/** The local sign-in link works before hydration, without an email step. */
export async function nativeSignIn(page, { origin }) {
  await page.goto(origin + "/signin?returnTo=/setup");
  // The local sign-in page offers one link per person; the owner entry is `as=owner`.
  await page.locator('a[href^="/auth/dev/enter?as=owner&"]').click();
  await page.waitForURL(origin + "/setup");
  assert.equal((await page.request.get(origin + "/api/app/session")).status(), 200);
}
