import { externalEvidencePath } from "../../scripts/evidence-path.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

export async function verifyEmptyWorkspace(origin) {
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/app");
    await expect(page.getByRole("heading", { name: "Sign in with a magic link." })).toBeVisible();
    await page.locator('main[data-signin-ready="true"]').waitFor();
    await page.getByText("Set up the first operator", { exact: true }).click();
    await page.getByLabel("Your name").fill("Empty workspace operator");
    await page.getByLabel("Setup token").fill("dial-test-only-setup-token-at-least-32");
    const document = page.waitForResponse((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/setup");
    await page.getByRole("button", { name: "Complete setup" }).click();
    const setupDocument = await document;
    assert.equal(setupDocument.status(), 200, "native bootstrap renders the private setup document");
    assert.match(await setupDocument.text(), /Set up your scheduling workspace/, "native SSR renders first run before hydration");
    await expect(page).toHaveURL(origin + "/setup");
    const profile = await page.request.get(origin + "/api/app/profile");
    // The private singleton returns successful absence; public unknown profiles retain 404.
    assert.equal(profile.status(), 200);
    assert.equal(await profile.json(), null);
    assert.equal((await page.request.get(origin + "/api/public/profiles/unknown-host")).status(), 404);
    assert.equal((await page.request.get(origin + "/book/unknown-host")).status(), 404);
    for (const path of ["/api/app/event-types", "/api/app/bookings", "/api/app/availability-requests"]) {
      const response = await page.request.get(origin + path);
      assert.equal(response.status(), 200, "unfinished native owners can use the product APIs");
      assert.deepEqual(await response.json(), []);
    }
    const setup = await (await page.request.get(origin + "/api/app/host-setup")).json();
    assert.equal(setup.completedAt, null);
    assert.equal(setup.profileReady, false);
    assert.equal(setup.eventTypeId, null);
    assert.deepEqual(setup.links, []);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 900 : 1050 });
      await page.goto(origin + "/app");
      await expect(page).toHaveURL(origin + "/setup");
      await expect(page.getByRole("list", { name: "First-run checklist", exact: true })).toBeVisible();
      await expect(page.locator("[data-step]")).toHaveCount(7);
      await expect(page.locator('[data-step="profile"]')).toContainText("To do");
      await expect(page.locator('[data-step="event"]')).toContainText("To do");
      await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("0 bookings", { exact: true })).toHaveCount(0);
      await expect(page.getByText("0 requests", { exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
      await capture(page, width === 390 ? "mobile" : "desktop");
      await page.getByRole("link", { name: "Host profile", exact: true }).click();
      await expect(page).toHaveURL(origin + "/setup/profile");
      await emptyProfile(page);
      // A hydrated edit proves that both responsive setup editors are usable.
      await page.getByRole("button", { name: "Add focus area", exact: true }).click();
      await page.getByLabel("Focus area 1", { exact: true }).fill("A new focus area");
      await expect(page.getByText("A new focus area", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Remove focus area 1", exact: true }).click();
      await expect(page.getByLabel("Focus area 1", { exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "the empty profile editor fits the viewport");
      await capture(page, width === 390 ? "mobile-profile" : "desktop-profile");
      await page.getByRole("navigation", { name: "Setup navigation" }).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(origin + "/setup/settings");
      await expect(page.getByRole("button", { name: "Check sender", exact: true })).toBeEnabled();

      // Real setup profile reads encounter test-only transport faults. No failure
      // may become a blank editable profile or permit a destructive empty save.
      for (const [status, code, message] of [
        [404, "profile_not_found", "Unexpected profile endpoint failure."],
        [401, "unauthorized", "Operator session expired."],
        [503, "database_unavailable", "Profile database unavailable."],
      ]) {
        await page.route("**/api/app/profile", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message } }) }));
        await page.goto(origin + "/setup/profile");
        await unavailableProfile(page);
        await page.unroute("**/api/app/profile");
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await emptyProfile(page);
      }
      await page.route("**/api/app/profile", (route) => route.abort("failed"));
      await page.goto(origin + "/setup/profile");
      await unavailableProfile(page);
      await page.unroute("**/api/app/profile");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await emptyProfile(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      assert.equal((await (await page.request.get(origin + "/api/app/profile")).json()), null, "unsaved editor actions and failed reads never create a profile");
    }
    assert.deepEqual(errors, [], "hydration and rejected reads do not create uncaught JavaScript errors");
  } finally { await browser.close(); }
}

async function emptyProfile(page) {
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Host timezone", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled();
  await expect(page.getByText("Loading profile…", { exact: true })).toHaveCount(0);
}

async function unavailableProfile(page) {
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toHaveCount(0);
}

async function capture(page, name) {
  const directory = process.env.DIAL_EMPTY_WORKSPACE_EVIDENCE;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: externalEvidencePath(join(directory, `empty-workspace-${name}.png`)), fullPage: true });
}
