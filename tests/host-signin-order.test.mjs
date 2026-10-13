import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { contract } from "./contract.mjs";
import { coldHostRuntime } from "./host-setup/native-runtime.mjs";
import { localSignIn } from "./host-setup/local-signin.mjs";

contract("AUTH-001", "cold host waits for its single native mail request despite an already actionable local outbox link", async t => {
  const origin = await coldHostRuntime(t), browser = await chromium.launch({ headless: true });
  let release, signingIn, barrierTimeout;
  try {
    const context = await browser.newContext();
    const bootstrap = await context.request.post(origin + "/auth/bootstrap", { headers: { Origin: origin }, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Ordering owner", returnTo: "/app" }, maxRedirects: 0 });
    assert.equal(bootstrap.status(), 303);
    await context.clearCookies();
    const page = await context.newPage(); await page.goto(origin + "/signin");
    let intercepted, posts = 0, delivered = false, accepted = false;
    const outboxRequests = [];
    const held = new Promise(done => { intercepted = done; });
    const gate = new Promise(done => { release = done; });
    await page.route("**/api/auth/magic-links", async route => { posts++; intercepted(); await gate; delivered = true; await route.continue(); });
    page.on("response", response => { if (new URL(response.url()).pathname === "/api/auth/magic-links") accepted = response.status() === 202; });
    page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/__dev/outbox" && !url.search && request.isNavigationRequest()) outboxRequests.push({ delivered, accepted }); });
    signingIn = localSignIn(page, origin);
    // A missing request must report a failure, not leave the controller waiting forever.
    try {
      await Promise.race([
        held,
        signingIn.then(() => { throw new Error("Sign-in completed without reaching the native POST barrier"); }),
        new Promise((_, reject) => { barrierTimeout = setTimeout(() => reject(new Error("Native sign-in POST did not reach the barrier within 30 seconds")), 30_000); }),
      ]);
    } finally { clearTimeout(barrierTimeout); }
    await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "Open local outbox", exact: true }).click({ trial: true });
    assert.equal(delivered, false, "the real native POST is still held before delivery");
    assert.deepEqual(outboxRequests, [], "an already actionable link must not cause early outbox navigation");
    release();
    await signingIn;
    assert.equal(posts, 1, "the flow sends exactly one native request without a resend");
    assert.deepEqual(outboxRequests, [{ delivered: true, accepted: true }]);
    const session = await context.request.get(origin + "/api/app/session");
    assert.equal(session.status(), 200);
    assert.equal((await session.json()).operator.email, "operator@dial.test", "the actual mail link and Confirm establish the native session");
  } finally { release?.(); await browser.close(); await signingIn?.catch(() => {}); }
});
