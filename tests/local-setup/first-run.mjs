import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function completeFirstRun(page, origin, onPhase = () => {}) {
  onPhase("first-run empty installation");
  assert.equal(await (await page.request.get(origin + "/api/app/profile")).json(), null);
  assert.deepEqual(await (await page.request.get(origin + "/api/app/event-types")).json(), []);
  onPhase("first-run private document guard");
  await page.goto(origin + "/app/bookings"); await page.waitForURL(origin + "/setup");
  const setupDocument = await page.reload();
  assert.equal(setupDocument.status(), 200);
  assert.match(setupDocument.headers()["content-type"], /^text\/html\b/i);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  onPhase("first-run profile editor");
  await page.getByRole("link", { name: "Host profile", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Local owner");
  await page.getByLabel("Title", { exact: true }).fill("Preserved local work");
  await page.getByLabel("Public handle", { exact: true }).fill("preserved-host");
  await page.getByRole("combobox", { name: "Host timezone", exact: true }).fill("Australia/Brisbane");
  await page.getByRole("option", { name: "Australia/Brisbane", exact: true }).click();
  await page.getByLabel("Biography", { exact: true }).fill("Owner data survives restore.");
  onPhase("first-run profile save");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/profile" && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save profile", exact: true }).click(); assert.equal((await saved).status(), 200);
  const profile = await (await page.request.get(origin + "/api/app/profile")).json();
  onPhase("first-run settings navigation");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  onPhase("first-run authenticated server function guard");
  // The native dev compiler exposes each server function's actual HTTP URL.
  // Probe this private transport explicitly: root document loads are public,
  // and authorization proof must not depend on sibling navigation request order.
  const privatePath = await page.evaluate(async () => {
    const { loadSetupShell } = await import("/src/core/app/loaders.ts");
    return loadSetupShell.url;
  });
  const endpoint = new URL(privatePath, origin);
  assert.equal(endpoint.origin, origin, "the generated private function stays same-origin");
  assert.ok(endpoint.pathname.startsWith("/_serverFn/"), "the probe uses the compiler-generated HTTP transport");
  // Preserve browser same-origin metadata while varying only the session.
  const headers = { "x-tsr-serverFn": "true", "sec-fetch-site": "same-origin", origin, referer: origin + "/setup/settings" };
  const authenticated = await page.request.get(endpoint.href, { headers, maxRedirects: 0 });
  assert.equal(authenticated.status(), 200, "the private setup function accepts the native session");
  assert.ok((await authenticated.text()).includes(profile.name), "the authenticated private shell includes the saved host");
  onPhase("first-run anonymous server function guard");
  const refused = await fetch(endpoint, { redirect: "manual", headers });
  const refusal = (refused.headers.get("location") ?? "") + await refused.text();
  assert.match(refusal, /signin/, "private setup server function independently redirects an anonymous caller");
  assert.ok(!refusal.includes(profile.name), "anonymous loader exposes no saved private shell");
  onPhase("first-run mail connection check");
  await page.getByRole("button", { name: "Check sender", exact: true }).click();
  await expect(page.getByText("Mail sender verified.", { exact: true })).toBeVisible();
  onPhase("first-run event editor");
  await page.getByRole("link", { name: "Event types", exact: true }).click();
  await page.getByRole("link", { name: "New event type", exact: true }).first().click();
  await page.getByLabel("Event name", { exact: true }).fill("First request");
  await page.getByLabel("Description", { exact: true }).fill("Suggest a time to meet.");
  await page.getByRole("combobox", { name: "Location kind", exact: true }).selectOption("phone");
  await page.getByLabel("Private link, number, or address", { exact: true }).fill("+1 202 555 0100");
  onPhase("first-run event save");
  await page.getByRole("button", { name: "Save changes", exact: true }).click(); await page.waitForURL(/\/availability$/);
  // A request-only event keeps its empty exception; your set-once hours stay available to other events.
  const eventId = new URL(page.url()).pathname.split("/").at(-2);
  const own = page.getByRole("radio", { name: "Its own hours", exact: true });
  await expect(page.getByRole("radio", { name: "Your hours", exact: true })).toBeChecked();
  const chosen = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${eventId}/hours` && response.request().method() === "PUT");
  await own.check(); assert.equal((await chosen).status(), 200);
  const remove = page.getByRole("button", { name: "Remove hours", exact: true });
  for (let left = 20; left && await remove.count(); left--) {
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${eventId}/availability` && response.request().method() === "PUT");
    await remove.first().click(); assert.equal((await saved).status(), 200);
  }
  await page.reload(); await expect(own).toBeChecked();
  assert.deepEqual((await (await page.request.get(origin + `/api/app/event-types/${eventId}`)).json()).availability, [], "hours edits survive a reload without a Save button");
  await page.getByRole("link", { name: "Back to event", exact: true }).click();
  onPhase("first-run request publication");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Open requests", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  onPhase("first-run booking link copy");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Booking link copied.", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin + "/book/preserved-host/first-request");
  onPhase("first-run completion checklist");
  await page.locator('nav[aria-label="Setup navigation"] a[href="/setup"]').click();
  const checklistResponse = await page.request.get(origin + "/api/app/host-setup");
  assert.equal(checklistResponse.status(), 200);
  const checklist = await checklistResponse.json();
  assert.equal(checklist.calendar.state, "disconnected");
  assert.equal(checklist.steps.find(step => step.id === "calendar").optional, true);
  assert.equal(checklist.availabilityReady, false, "Open requests has no availability windows");
  assert.equal(checklist.steps.find(step => step.id === "availability").done, false);
  await expect(page.locator('[data-step="availability"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeEnabled();
  onPhase("first-run finish setup");
  const completed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/host-setup/complete" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  assert.equal((await completed).status(), 200, "request-only setup completes without a calendar or availability");
  await page.waitForURL(origin + "/app");
  onPhase("first-run completion persistence");
  const state = await (await page.request.get(origin + "/api/app/host-setup")).json(); assert.ok(state.completedAt);
  assert.equal(state.calendar.state, "disconnected");
  assert.equal(state.availabilityReady, false);
  await page.goto(origin + "/setup"); await page.waitForURL(origin + "/app");
  return profile;
}
