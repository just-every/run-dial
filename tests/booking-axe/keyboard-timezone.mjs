import assert from "node:assert/strict";
import { field } from "./keyboard-controls.mjs";

export async function timezoneKeyboardJourney(page, keys, width, checks) {
  const timezone = field(page, "View in timezone");
  const original = await timezone.inputValue();
  const slots = await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt));
  await keys.type(timezone, "Mars/Olympus", "Invalid timezone"); await page.keyboard.press("Tab");
  const error = page.getByRole("alert").filter({ hasText: "current zone and times are unchanged" }); await error.waitFor();
  assert.equal(await timezone.getAttribute("aria-invalid"), "true");
  assert.equal(await timezone.getAttribute("aria-describedby"), await error.getAttribute("id"));
  assert.deepEqual(await page.locator(".pb-slot-button").evaluateAll(elements => elements.map(el => el.dataset.startAt)), slots);
  await keys.screenshot("timezone-error");
  await keys.type(timezone, "new york", "Search timezone");
  await page.getByRole("listbox", { name: "Matching timezones", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await timezone.inputValue(), original); assert.equal(await timezone.getAttribute("aria-expanded"), "false");
  assert.ok(await timezone.evaluate(el => el === globalThis.document.activeElement));
  await keys.type(timezone, "Australia/Brisbane", "Choose valid timezone");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("timezone") === "Australia/Brisbane");
  await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await timezone.getAttribute("aria-invalid"), "false");
  checks.push({ width, flow: "Timezone combobox invalid alert and description, unchanged slots, keyboard search, Escape and valid selection", passed: true });
}
