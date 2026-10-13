import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { assertSafeEvidenceSurface, safeBrowserFailure } from "./evidence-safety.mjs";
import { assertNoAxeViolations, assertNoHorizontalOverflow, browserCheck } from "./browser-diagnostics.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { openGateFromLink } from "../dev-key.mjs";

export async function browserJourney(origin, { setupToken, email, name, review = false, width, openUrl, onSignedIn, bootstrapDeniedToken, completed = false, issuedSignInUrl }) {
  let browser;
  let phase = "browser launch", currentWidth = 0;
  const expectedOrigin = new URL(origin).origin;
  const secrets = [setupToken].filter(Boolean);
  const diagnostics = { responses: [], console: [], hydrationDiff: [] };
  try {
    browser = await chromium.launch({ headless: true });
    {
      currentWidth = width; phase = "sign-in page";
      const context = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", viewport: { width, height: width === 390 ? 844 : 900 }, permissions: ["clipboard-read", "clipboard-write"] });
      // The development outbox answers only a browser holding the checkout's key gate cookie, which RER_OPEN's link trades the key for.
      if (openUrl) await openGateFromLink(context, openUrl);
      try {
        const page = await context.newPage();
        const errors = [];
        let magicLinkRequests = 0;
        page.on("pageerror", () => errors.push("pageerror"));
        page.on("console", message => { if (message.type() === "error") { errors.push("console-error"); diagnostics.console.push(/hydrat|did not match|server.*html/i.test(message.text()) ? "hydration" : /Failed to load resource/i.test(message.text()) ? "resource" : "other");
          if (/hydrat|did not match|server.*html/i.test(message.text())) diagnostics.hydrationDiff.push(...message.text().split("\n").filter(line => /^\s*[+-]\s/.test(line)).map(line => {
            for (const secret of secrets.filter(Boolean)) line = line.split(secret).join("[redacted]");
            return line.replace(/https?:\/\/[^\s<>"']+/g, "[url]").replace(/[A-Za-z0-9_-]{32,}/g, "[id]");
          })); } else if (message.type() === "warning" && /hydrat|did not match|server.*html/i.test(message.text())) errors.push("hydration-warning"); });
        page.on("response", response => {
          if (response.status() >= 400) diagnostics.responses.push({ status: response.status(), type: response.request().resourceType(), path: new URL(response.url()).pathname.replace(/[A-Za-z0-9_-]{32,}/g, "[id]") });
        });
        page.on("request", request => {
          const url = new URL(request.url());
          if (url.origin === expectedOrigin && ["/api/auth/magic-links", "/auth/magic-link"].includes(url.pathname) && request.method() === "POST") magicLinkRequests++;
        });
        await page.goto(origin + "/signin");
        await expect(page.getByRole("heading", { name: "Sign in with a magic link." })).toBeVisible();
        await waitForSignInReady(page);
        await expect(page.getByRole("link", { name: "Dial", exact: true })).toBeVisible();
        await scan(page);
        await expect(page.getByLabel("Email address", { exact: true })).toBeEnabled();
        await expect(page.getByRole("link", { name: "Open local outbox", exact: true })).toBeVisible();
        await expect(page.getByText("Set up the first operator", { exact: true })).toHaveCount(setupToken ? 1 : 0);
        if (setupToken) {
          await page.getByText("Set up the first operator", { exact: true }).click();
          await expect(page.getByText(/Open .dev.vars in your local project and copy the SETUP_TOKEN value/)).toBeVisible();
          phase = "first operator setup";
          await page.getByLabel("Your name").fill(name);
          await page.getByLabel("Setup token").fill(setupToken);
          await page.getByRole("button", { name: "Complete setup", exact: true }).click();
          await page.waitForURL(origin + (completed ? "/app" : "/setup"));
          const profile = await page.request.get(origin + "/api/app/profile");
          assert.equal(profile.status(), 200);
          assert.equal(await profile.json(), null);
          assert.deepEqual(await (await page.request.get(origin + "/api/app/event-types")).json(), []);
          await signOut(page, width);
        }
        if (bootstrapDeniedToken) {
          const refused = await page.request.post(origin + "/auth/bootstrap", { headers: { origin }, data: { token: bootstrapDeniedToken, displayName: "Second owner" } });
          assert.equal(refused.status(), 409, "forced setup cannot claim a second owner");
        }
        if (issuedSignInUrl !== undefined) {
          phase = "command-issued outbox";
          assert.ok(issuedSignInUrl === expectedOrigin + "/__dev/outbox", "native readiness names the same-origin development outbox");
        } else {
          phase = "link request";
          await waitForSignInReady(page);
          await page.getByLabel("Email address", { exact: true }).fill(email);
          const accepted = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.origin === expectedOrigin && url.pathname === "/api/auth/magic-links" && response.request().method() === "POST";
          });
          await page.getByRole("button", { name: "Send magic link", exact: true }).click();
          const response = await accepted;
          assert.equal(response.status(), 202, "the magic-link request is accepted before opening the local outbox");
          await expect(page.getByRole("link", { name: "Open local outbox", exact: true })).toBeVisible();
          assert.equal(magicLinkRequests, 1, "one native magic-link request is sent without retry or fallback");
          await scan(page);
        }
        phase = "outbox listing";
        if (issuedSignInUrl !== undefined) await page.goto(issuedSignInUrl);
        else await page.getByRole("link", { name: "Open local outbox", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Development outbox", exact: true })).toBeVisible();
        await scan(page);
        // Subjects and headings carry no capability; they say which message and page a failure saw.
        const where = async () => { diagnostics.page = { path: new URL(page.url()).pathname, heading: (await page.locator("h1").first().textContent({ timeout: 1000 }).catch(() => null)) ?? null }; };
        diagnostics.outbox = await page.locator("article h2").allTextContents();
        phase = "outbox message open";
        // The outbox is newest first; recovery mail can precede the newest sign-in mail.
        const signInMessages = page.locator("article").filter({ has: page.getByRole("heading", { level: 2, name: "Your sign-in link for Dial", exact: true }) });
        const signInMessage = signInMessages.first();
        diagnostics.outboxSelection = { subject: await signInMessage.getByRole("heading", { level: 2 }).textContent(), matchingMessages: await signInMessages.count() };
        console.info(`Local sign-in outbox selection: ${JSON.stringify({ subjects: diagnostics.outbox, ...diagnostics.outboxSelection })}`);
        // Exercise the actual mail and link privately: no screenshot, trace or HTML artifact.
        await signInMessage.getByRole("link", { name: "Read message", exact: true }).click();
        await where();
        await scan(page);
        phase = "outbox sign-in link";
        await page.getByRole("link", { name: "Open this link", exact: true }).click();
        await where();
        phase = "confirmation page";
        await expect(page.getByRole("heading", { name: "Confirm sign-in to Dial", exact: true })).toBeVisible();
        await scan(page);
        const confirmationUrl = page.url();
        secrets.push(new URL(confirmationUrl).searchParams.get("token"));
        phase = "confirmation evidence";
        await capture(page, `${review ? "review" : "local"}-confirm-${width}.png`, secrets);
        phase = "confirm sign-in";
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        phase = "confirmed destination";
        await page.waitForURL(origin + (completed ? "/app" : "/setup"));
        phase = "confirmed session";
        assert.equal((await page.request.get(origin + "/api/app/session")).status(), 200);
        phase = "confirmed accessibility";
        await scan(page);
        await checkOverflow(page);
        phase = "signed-in callback";
        await onSignedIn?.(page, value => { phase = value; });
        phase = "return to setup";
        await browserCheck("navigation", () => page.goto(origin + "/setup"));
        await scan(page);
        await checkOverflow(page);
        phase = "signed-in evidence";
        await capture(page, `${review ? "review" : "local"}-signed-in-${width}.png`, secrets);
        phase = "sign out";
        await signOut(page, width);
        phase = "browser console checks";
        assert.deepEqual(errors, []);
        // The consumed link takes the same recovery page as an expired link.
        phase = "expired-link recovery";
        const expired = await page.goto(confirmationUrl);
        assert.equal(expired.status(), 400);
        await expect(page.getByRole("link", { name: "Request a new link", exact: true })).toHaveAttribute("href", "/signin");
        await expect(page.getByRole("heading", { name: "This link is invalid or expired", exact: true })).toBeVisible();
        await scan(page);
        await capture(page, `${review ? "review" : "local"}-expired-${width}.png`, secrets);
        // A rejected document is the expected browser console event for this explicit expiry check.
        assert.equal(errors.includes("pageerror"), false);
        if (issuedSignInUrl !== undefined) assert.equal(magicLinkRequests, 0, "the command-issued link is consumed without requesting another magic link");
      } finally { await context.close(); }
    }
  } catch (error) {
    await writeFile(evidencePath(`${review ? "review" : "local"}-failure-${width}.json`), JSON.stringify({ phase, width, ...diagnostics }, null, 2), { mode: 0o600 });
    throw safeBrowserFailure(phase, currentWidth, error, diagnostics);
  }
  finally { await browser?.close().catch(() => { throw safeBrowserFailure("browser cleanup", currentWidth); }); }
}
async function signOut(page, width) {
  // The Overview starts its platform read after host setup resolves. Wait for
  // that real read to render before revoking the session; otherwise this test
  // can deliberately race the new request into an expected anonymous 401.
  await expect(page.getByRole("heading", { name: "Integrations and delivery", exact: true })).toBeVisible();
  for (const name of ["database", "storage", "queue"]) {
    await expect(page.getByRole("heading", { name, exact: true }).locator("..")).toContainText("Last checked");
  }
  if (width === 390 && new URL(page.url()).pathname.startsWith("/app")) await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(/\/signin/);
  assert.equal((await page.request.get(new URL("/api/app/session", page.url()).href)).status(), 401, "sign out revokes the session");
  await waitForSignInReady(page);
}
async function waitForSignInReady(page) {
  await expect(page.locator('main[data-signin-ready="true"]')).toBeVisible();
}
async function scan(page) {
  await browserCheck("accessibility", async () => {
    const result = await new AxeBuilder({ page }).analyze();
    assertNoAxeViolations(result.violations);
  });
}
async function checkOverflow(page) {
  await browserCheck("horizontal_overflow", async () => {
    assertNoHorizontalOverflow(await page.evaluate("document.documentElement.scrollWidth > innerWidth"));
  });
}

async function capture(page, filename, secrets) {
  assertSafeEvidenceSurface(page.url(), await page.locator("body").innerText(), secrets);
  await page.screenshot({ path: evidencePath(filename), fullPage: true, caret: "initial" });
}
