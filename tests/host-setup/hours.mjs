import assert from "node:assert/strict";
import { expect } from "@playwright/test";

/** Keep the Hours follow-up inside the existing desktop host journey. */
export async function hoursJourney(page, origin, eventId, setOffline = () => {}) {
  for (const [path, current] of [["/app/settings", "Settings"], ["/app/settings/hours", "Hours"], [`/app/event-types/${eventId}/availability`, "Event types"], ["/app/settings/hours", "Hours"]]) {
    await page.goto(origin + path);
    const links = page.getByRole("navigation", { name: "Operator navigation" }).locator('[aria-current="page"]').filter({ visible: true });
    await expect(links).toHaveText([current]);
  }
  await expect(page.getByRole("button", { name: /^Save(?: changes)?$/ })).toHaveCount(0);
  const monday = page.getByRole("group", { name: "Monday", exact: true });
  const pill = monday.locator("summary").first();
  await expect(pill).toHaveAccessibleName(`Monday ${await pill.innerText()}`);
  await pill.click();
  const end = monday.getByLabel("Monday window 1 end time", { exact: true });
  const start = monday.getByLabel("Monday window 1 start time", { exact: true });
  const original = await end.inputValue();
  let writes = 0;
  const count = request => { if (request.method() === "PUT" && new URL(request.url()).pathname.startsWith("/api/app/availability-schedules/")) writes++; };
  page.on("request", count);
  try {
    await end.fill(await start.inputValue());
    await expect(monday.getByRole("alert")).toHaveText("Ends before it starts. Choose a later end time.");
    await expect(end).toHaveAttribute("aria-invalid", "true");
    await expect(end).toHaveValue(await start.inputValue());
    assert.equal(writes, 0, "invalid windows never reach the save endpoint");
    await end.fill(original);
    await expect(monday.getByRole("alert")).toHaveCount(0);
    const endpoint = "**/api/app/availability-schedules/*";
    let release;
    const held = new Promise(done => { release = done; });
    await page.route(endpoint, async route => {
      if (route.request().method() !== "PUT") return route.continue();
      await held;
      await route.fulfill({ response: await route.fetch() });
    });
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname.startsWith("/api/app/availability-schedules/"));
    await end.fill("18:00");
    await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
    release();
    assert.equal((await saved).status(), 200);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.unroute(endpoint);
    const afterSave = writes;
    await end.fill("18:00");
    await page.waitForTimeout(800);
    assert.equal(writes, afterSave, "no change sends no request");
    setOffline(true);
    await page.route(endpoint, route => route.abort("failed"));
    await end.fill("19:00");
    await expect(page.getByText(/Couldn’t save your hours/)).toBeVisible();
    await expect(end).toHaveValue("19:00");
    setOffline(false);
    await page.unroute(endpoint);
    const retry = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname.startsWith("/api/app/availability-schedules/"));
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    assert.equal((await retry).status(), 200);
    const restored = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname.startsWith("/api/app/availability-schedules/"));
    await end.fill(original);
    assert.equal((await restored).status(), 200);
    await page.locator("summary").filter({ hasText: /^Other hours/ }).click();
    const existing = await (await page.request.get(origin + "/api/app/availability-schedules")).json();
    let uniqueName = "Evenings";
    for (let number = 2; existing.some(schedule => schedule.name === uniqueName); number++) uniqueName = `Evenings ${number}`;
    await page.getByRole("button", { name: "Add other hours", exact: true }).click();
    await page.getByLabel("Hours name", { exact: true }).fill(uniqueName);
    const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/app/availability-schedules");
    await page.getByRole("button", { name: "Add hours", exact: true }).last().click();
    assert.equal((await created).status(), 201);
    await page.getByRole("button", { name: "Add other hours", exact: true }).click();
    const name = page.getByLabel("Hours name", { exact: true });
    await name.fill(` ${uniqueName.toLowerCase()} `);
    await page.getByRole("button", { name: "Add hours", exact: true }).last().click();
    await expect(page.getByRole("alert")).toContainText("These hours already have that name. Choose another name.");
    await expect(name).toHaveValue(` ${uniqueName.toLowerCase()} `);
    const schedules = await (await page.request.get(origin + "/api/app/availability-schedules")).json();
    assert.equal(schedules.filter(schedule => schedule.name.toLowerCase() === uniqueName.toLowerCase()).length, 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add other hours", exact: true }).click();
    await page.getByLabel("Hours name", { exact: true }).fill(`${uniqueName} summer`);
    const second = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/app/availability-schedules");
    await page.getByRole("button", { name: "Add hours", exact: true }).last().click();
    assert.equal((await second).status(), 201);
    const rename = page.getByLabel(`Name for ${uniqueName} summer`, { exact: true });
    const beforeRename = writes;
    await rename.fill(uniqueName);
    await rename.blur();
    await expect(rename).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toContainText("These hours already have that name. Choose another name.");
    await expect(rename).toHaveValue(uniqueName);
    assert.equal(writes, beforeRename, "duplicate rename sends no write");
    await rename.fill(`${uniqueName} summer`);
    await rename.blur();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { page.off("request", count); }
}
