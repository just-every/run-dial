import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function overviewHealth(page, origin, { calendar, mail }) {
  const state = await (await page.request.get(origin + "/api/app/host-setup")).json();
  for (const [key, title, expected] of [["calendar", "Google Calendar", calendar], ["mail", "Transactional mail", mail]]) {
    const connection = page.getByRole("heading", { name: title, exact: true }).locator("../..");
    assert.equal(state[key].state, expected);
    await expect(connection).toContainText(expected === "unchecked" ? "Not yet checked" : expected);
    if (expected === "unchecked") {
      assert.equal(state[key].reason, null);
      assert.equal(state[key].checkedAt, null);
      await expect(connection).not.toContainText("missing configuration");
      await expect(connection).not.toContainText("unhealthy");
    }
    if (state[key].checkedAt === null) await expect(connection).toContainText("Not yet checked");
    else {
      assert.ok(Number.isFinite(Date.parse(state[key].checkedAt)));
      await expect(connection).toContainText("Last checked");
      await expect(connection).toContainText("UTC");
    }
    if (state[key].reason) await expect(connection).toContainText(state[key].reason.replaceAll("_", " "));
  }
  for (const name of ["database", "storage", "queue"]) {
    const check = page.getByRole("heading", { name, exact: true }).locator("..");
    await expect(check).toContainText("Healthy");
    await expect(check).toContainText("Last checked");
    await expect(check).toContainText("UTC");
  }
}
