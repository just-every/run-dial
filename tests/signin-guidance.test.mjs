import assert from "node:assert/strict";
import { after } from "node:test";
import { expect } from "@playwright/test";
import { contract } from "./contract.mjs";
import { closeImplementation, deployed, failingSender, fixture, local, unknown } from "./signin-privacy/fixture.mjs";
import { signInBrowser } from "./signin-privacy/browser.mjs";

after(closeImplementation);
for (const [runtime, guidance] of [
  [local, "Open the local outbox to look for a sign-in link. If it is missing, check operator access and local mail."],
  [deployed, "Check your email for a sign-in link. If it does not arrive, ask the install’s operator to check access and mail."],
]) {
  contract("AUTH-001", `${runtime.ENVIRONMENT} sign-in guides anonymous callers without claiming failed mail was delivered`, async context => {
    const delivery = failingSender("uncertain");
    const native = await fixture(runtime, delivery.sender);
    context.after(() => native.close());
    const { page, errors, requests } = await signInBrowser(context, native);
    const messages = [];
    for (const email of [unknown, runtime.OWNER_EMAIL]) {
      await page.getByLabel("Email address", { exact: true }).fill(email);
      const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/magic-links");
      await page.getByRole("button", { name: "Send magic link", exact: true }).click();
      assert.equal((await response).status(), 202);
      await expect(page.getByRole("status")).toBeVisible();
      messages.push(await page.getByRole("status").textContent());
      await expect(page.getByRole("link", { name: "Open local outbox", exact: true })).toHaveCount(runtime === local ? 1 : 0);
      if (runtime === local) await expect(page.getByRole("link", { name: "Open local outbox", exact: true })).toHaveAttribute("href", "/__dev/outbox");
    }
    assert.deepEqual(requests.map(request => request.email), [unknown, runtime.OWNER_EMAIL]);
    assert.equal(delivery.tokens.length, 1);
    assert.equal(native.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens WHERE revoked_at IS NOT NULL").get().n, 1);
    assert.equal(native.sessions(), 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(messages, [guidance, guidance]);
  });
}
