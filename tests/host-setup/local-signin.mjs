import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { openGate } from "../dev-key.mjs";

export async function localSignIn(page, origin) {
  await openGate(page.context(), origin);
  // This journey requires the enhanced JSON request, not a native form navigation.
  await page.locator('main[data-signin-ready="true"]').waitFor();
  await page.getByLabel("Email address", { exact: true }).fill("operator@dial.test");
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/magic-links" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send magic link", exact: true }).click();
  assert.equal((await accepted).status(), 202, "native sign-in request is accepted before opening its local outbox");
  await expect(page.getByRole("status")).toHaveText("Open the local outbox to look for a sign-in link. If it is missing, check operator access and local mail.");
  await page.getByRole("link", { name: "Open local outbox", exact: true }).click();
  await page.getByRole("link", { name: "Read message", exact: true }).first().click();
  await page.getByRole("link", { name: "Open this link", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForURL(origin + "/setup");
}
