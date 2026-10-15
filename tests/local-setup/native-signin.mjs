import assert from "node:assert/strict";
/** The local sign-in link works before hydration, without an email step. */
export async function nativeSignIn(page, { origin }) {
  await page.goto(origin + "/signin?returnTo=/setup");
  await page.getByRole("link", { name: "Continue as owner", exact: true }).click();
  await page.waitForURL(origin + "/setup");
  assert.equal((await page.request.get(origin + "/api/app/session")).status(), 200);
}
