import assert from "node:assert/strict";
import { field } from "./keyboard-controls.mjs";

export async function timezoneKeyboardJourney(page, keys, width, checks) {
  const timezone = field(page, "View in timezone");
  const original = await timezone.inputValue();
  const slots = await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt));
  await keys.type(timezone, "Mars/Olympus", "Search timezone without matches");
  const empty = page.getByRole("status").filter({ hasText: "No matching timezones" }); await empty.waitFor();
  assert.equal(await timezone.getAttribute("aria-expanded"), "true");
  assert.equal(await timezone.getAttribute("aria-describedby"), await empty.getAttribute("id"));
  assert.equal(await page.getByRole("listbox", { name: "Matching timezones", exact: true }).getByRole("option").count(), 0);
  await keys.screenshot("timezone-no-results");
  await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
  assert.equal(await timezone.inputValue(), original);
  assert.deepEqual(await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt)), slots);
  await keys.type(timezone, "america", "Search timezone");
  await page.getByRole("listbox", { name: "Matching timezones", exact: true }).waitFor();
  const selected = page.getByRole("option", { selected: true });
  const first = await selected.getAttribute("id");
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await selected.getAttribute("id"), first);
  assert.equal(await timezone.getAttribute("aria-activedescendant"), await selected.getAttribute("id"));
  await page.keyboard.press("ArrowUp");
  assert.equal(await selected.getAttribute("id"), first);
  await page.keyboard.press("Escape");
  assert.equal(await timezone.inputValue(), original); assert.equal(await timezone.getAttribute("aria-expanded"), "false");
  assert.ok(await timezone.evaluate(el => el === globalThis.document.activeElement));
  await keys.type(timezone, "Australia/Brisbane", "Choose valid timezone");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("timezone") === "Australia/Brisbane");
  await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await timezone.inputValue(), "Australia/Brisbane");
  checks.push({ width, flow: "Timezone combobox no-results description, unchanged committed zone and slots, arrow navigation, Escape and valid selection", passed: true });
}
