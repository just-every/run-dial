import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../booking-axe/first-run-fixture.mjs";
import { searchWhileSaving } from "./search-while-saving.mjs";

// CUSTOM-001's page door: an event's private field saves as it is typed, with no button. A value typed and left at once
// by the menu is there after a reload; a save that fails keeps the value in the field, and Retry saves it. On Bookings, a
// booking's field saving slowly or refused never holds up Search, and a save that lands while Search has the booking off
// screen is what it shows when it is back.
const origin = process.env.DIAL_REVIEW_ORIGIN;
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
  const headers = { Origin: origin };
  const admitted = await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 });
  assert.equal(admitted.status(), 303);
  await completeEmptyWorkspace(owner, origin);
  const fixture = await (await owner.request.post(origin + "/__fixtures/setup", { data: {} })).json();
  const created = await owner.request.post(origin + "/api/app/custom-fields", { headers, data: { entity: "eventType", label: "Preparation", kind: "text", options: [] } });
  assert.equal(created.status(), 201);
  const field = await created.json();
  const stored = async () => (await (await owner.request.get(`${origin}/api/app/custom-fields/eventType/${fixture.eventId}`)).json()).find((entry) => entry.id === field.id).value;
  const page = await owner.newPage();
  const region = page.getByRole("region", { name: "Custom fields" });
  const open = async () => {
    await page.goto(`${origin}/app/event-types/${fixture.eventId}`);
    // The shell stays inert until it has hydrated: type only once it is ready, as an owner can.
    await page.locator('[data-operator-ready="true"]').waitFor();
    const input = region.getByRole("textbox", { name: field.label, exact: true });
    await input.waitFor();
    return input;
  };

  let input = await open();
  await input.pressSequentially("Bring the roadmap", { delay: 15 });
  await page.getByRole("navigation", { name: "Operator navigation" }).getByRole("link", { name: "Bookings", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/bookings");
  input = await open();
  assert.equal(await input.inputValue(), "Bring the roadmap", "a value typed and left at once is there after a reload");
  assert.equal(await stored(), "Bring the roadmap");

  await owner.setOffline(true);
  await input.press("End");
  await input.pressSequentially(" and last quarter's numbers", { delay: 15 });
  const failure = region.getByRole("alert");
  await failure.waitFor();
  assert.equal(await input.inputValue(), "Bring the roadmap and last quarter's numbers", "a failed save keeps the value in its field");
  await owner.setOffline(false);
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await failure.waitFor({ state: "detached" });
  assert.equal(await stored(), "Bring the roadmap and last quarter's numbers", "Retry saves the kept value");
  input = await open();
  assert.equal(await input.inputValue(), "Bring the roadmap and last quarter's numbers");
  console.log("CUSTOM-001 page: typed values save with no button, survive leaving at once, and a failed save keeps its value until Retry saves it.");
  await searchWhileSaving(owner, origin, fixture);
  console.log("CUSTOM-001 page: a slow or refused save never holds up Search on Bookings, the refused value is sent again when its booking is shown again, and a save that lands off screen is what the booking shows when it is back.");
} finally {
  await owner.close();
  await browser.close();
}
