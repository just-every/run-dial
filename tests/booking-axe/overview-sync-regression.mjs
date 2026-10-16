import assert from "node:assert/strict";
import { overviewCards } from "./overview-readiness.mjs";

/** Exercise the real private navigation transport, then prove saved changes survive a new snapshot. */
export async function overviewSynchronizationRegression(browser, origin, storageState) {
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1024 } });
  try {
    const page = await context.newPage();
    await page.goto(origin + "/app/settings");
    await page.locator('[data-operator-ready="true"]').waitFor();
    const held = Promise.withResolvers();
    const intercepted = Promise.withResolvers();
    await page.route("**/_serverFn/**", async route => {
      intercepted.resolve();
      await held.promise;
      await route.continue();
    });
    try {
      const nativeRead = page.waitForRequest(request => new URL(request.url()).pathname.startsWith("/_serverFn/"), { timeout: 30_000 });
      nativeRead.catch(() => {});
      const navigation = page.getByRole("link", { name: "Overview", exact: true }).click();
      navigation.catch(() => {});
      // Link activation can wait for its navigation; release the HTTP read independently.
      await Promise.race([intercepted.promise, nativeRead]);
      void navigation.catch(() => {});
      assert.equal(await page.getByText("0 bookings", { exact: true }).count(), 0, "an unfinished navigation never claims an empty booking list");
    } finally {
      held.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
    const { bookingCard, requestCard } = overviewCards(page);
    await bookingCard.getByText("2 bookings", { exact: true }).waitFor();
    await requestCard.getByText("2 requests", { exact: true }).waitFor();

    const profileResponse = await context.request.get(origin + "/api/app/profile");
    const profile = await profileResponse.json();
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Freshly saved scheduling title");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByText("Profile saved.", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await page.getByText("Freshly saved scheduling title", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Freshly saved scheduling title", { exact: true }).waitFor();
    const restored = await context.request.patch(origin + "/api/app/profile", { data: profile, headers: { Origin: origin } });
    assert.equal(restored.status(), 200);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.route("**/_serverFn/**", route => route.abort("failed"));
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await page.getByRole("heading", { name: "This page could not finish loading", exact: true }).waitFor();
    assert.equal(await page.getByText("0 bookings", { exact: true }).count(), 0, "a refused transport never becomes a false empty workspace");
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: "Reload page", exact: true }).click();
    await overviewCards(page).bookingCard.getByText("2 bookings", { exact: true }).waitFor();
    await overviewCards(page).requestCard.getByText("2 requests", { exact: true }).waitFor();
  } finally { await context.close(); }
}
