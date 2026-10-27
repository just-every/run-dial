import assert from "node:assert/strict";
import { button, field } from "./keyboard-controls.mjs";

/** Sheet close removes the row-opened entry, while direct links replace it. */
export async function eventSheetHistory(page, origin, eventId, title, keys, checks, width) {
  const eventPath = `/app/event-types/${eventId}`, listPath = "/app/event-types";
  const steps = [];
  async function at(path, step) {
    await page.waitForURL(origin + path);
    assert.equal(new URL(page.url()).pathname, path, step);
    if (/\/(advanced|hours)$/.test(path)) await page.locator("dialog[open]").waitFor({ state: "visible" });
    steps.push({ step, url: page.url() });
  }
  async function openEvent() {
    await keys.navigate("Event types");
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await keys.activate(card.getByRole("link", { name: "Edit", exact: true }), "Open event for sheet history");
    await field(page, "Name").waitFor();
    await at(eventPath, "List → event");
  }
  for (const { rowName, suffix, closeName } of [{ rowName: /^Advanced settings/, suffix: "advanced", closeName: "Close settings" }, { rowName: /^Hours/, suffix: "hours", closeName: "Close hours" }]) {
    for (const escape of [false, true]) {
      await openEvent();
      const row = page.locator("[data-event-page]").getByRole("link", { name: rowName });
      await keys.activate(row, `Open ${suffix} for history`);
      await at(`${eventPath}/${suffix}`, `${suffix}: row → sheet`);
      if (escape) await page.keyboard.press("Escape"); else await keys.activate(button(page, closeName), `Close ${suffix} for history`);
      await at(eventPath, `${suffix}: ${escape ? "Escape" : "×"} → event`);
      await page.waitForFunction(element => element === globalThis.document.activeElement, await row.elementHandle());
      await keys.restored(row, `${suffix} history close`);
      await page.goBack();
      await at(listPath, `${suffix}: Back after close → list`);
    }
    await openEvent();
    await keys.activate(page.locator("[data-event-page]").getByRole("link", { name: rowName }), `Open ${suffix} for Back and Forward`);
    await at(`${eventPath}/${suffix}`, `${suffix}: open before Back`);
    await page.goBack(); await at(eventPath, `${suffix}: Back from open → event`);
    await page.goForward(); await at(`${eventPath}/${suffix}`, `${suffix}: Forward → open sheet`);
    await keys.activate(button(page, closeName), `Close forwarded ${suffix}`);
    await at(eventPath, `${suffix}: close forwarded sheet → event`);
    await page.goBack(); await at(listPath, `${suffix}: Back after forwarded close → list`);
  }
  // Full-document navigation supplies no row marker; replacement must still avoid a reopened sheet.
  await page.goto(origin + `${eventPath}/advanced`);
  await button(page, "Close settings").waitFor();
  await at(`${eventPath}/advanced`, "Direct advanced link");
  await keys.activate(button(page, "Close settings"), "Close direct advanced link");
  await at(eventPath, "Direct advanced close → event");
  await page.goBack(); await at(listPath, "Back after direct advanced close → list");
  await openEvent();
  checks.push({ width, check: "Advanced and Hours ×/Escape consume row history; Back/Forward and direct-link replacement", steps, passed: true });
}
