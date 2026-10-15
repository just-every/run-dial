import assert from "node:assert/strict";
import { localMagicLink } from "../auth-client.mjs";

/** This hosted-shaped test rig delivers through its test-owned provider. */
export async function localSignIn(page, origin) {
  await page.locator('main[data-signin-ready="true"]').waitFor();
  await page.getByLabel("Email address", { exact: true }).fill("operator@dial.test");
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/magic-links" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send magic link", exact: true }).click();
  assert.equal((await accepted).status(), 202);
  await page.goto((await localMagicLink(origin)).developmentLink);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForURL(origin + "/setup");
}
