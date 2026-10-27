import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// A second signed-in context models another operator removing the saved event.
export async function deletedEventRecovery(browser, owner, origin, eventId, requestsOnly) {
  const headers = { Origin: origin };
  const source = await (await owner.request.get(origin + `/api/app/event-types/${eventId}`)).json();
  const created = await owner.request.post(origin + "/api/app/event-types", { headers, data: { ...source, availability: undefined, slug: "publication-recovery", hours: { uses: "own", windows: source.availability } } });
  assert.equal(created.status(), 201);
  const event = await created.json();
  const context = await browser.newContext({ storageState: await owner.storageState() });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("Uncaught browser error"));
    page.on("console", message => { if (/hydration|hydrating|did not match/i.test(message.text())) errors.push("Hydration diagnostic"); });
    await page.goto(origin + `/setup/event-types/${event.id}`);
    const action = page.getByRole("button", { name: requestsOnly ? "Open requests" : "Publish event type", exact: true });
    await expect(action).toBeEnabled();
    assert.equal((await owner.request.delete(origin + `/api/app/event-types/${event.id}`, { headers })).status(), 204);
    const refusal = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${event.id}/${requestsOnly ? "open-requests" : "publish"}`);
    await action.click();
    const response = await refusal;
    assert.equal(response.status(), 404);
    assert.deepEqual((await response.json()).error.details, ["event_not_found"]);
    const recovery = page.getByRole("link", { name: "Choose an existing event type.", exact: true });
    await expect(recovery).toBeVisible(); await expect(recovery).toHaveAttribute("href", "/setup/event-types");
    await expect(page.getByRole("button", { name: "Publish event type", exact: true })).toBeDisabled();
    await recovery.click(); await page.waitForURL(origin + "/setup/event-types");
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
