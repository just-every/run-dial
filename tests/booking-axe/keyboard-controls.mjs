import assert from "node:assert/strict";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { keyboardFocus } from "./audit.mjs";

export const button = (page, name) => page.getByRole("button", { name, exact: true });
export const field = (page, name) => page.getByLabel(name, { exact: true });
function paint(element) {
  const style = globalThis.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, boxShadow: style.boxShadow, borderColor: style.borderColor, backgroundColor: style.backgroundColor, focused: element === globalThis.document.activeElement, visible: element.matches(":focus-visible"), inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= globalThis.innerHeight && rect.right <= globalThis.innerWidth };
}
export function keyboardControls(page, width, checks) {
  let sequence = 0;
  async function focus(target, label) {
    await target.waitFor({ state: "visible" });
    await target.page().waitForFunction(element => !element.matches(":disabled"), await target.elementHandle());
    // Move away using the keyboard when a browser/React restoration already
    // focuses this control, so the before/after paint comparison is meaningful.
    if (await target.evaluate(el => el === globalThis.document.activeElement)) await page.keyboard.press("Shift+Tab");
    const before = await target.evaluate(paint);
    await keyboardFocus(page, target);
    await target.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))); });
    const after = await target.evaluate(paint);
    const painted = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0 && after.outlineColor !== "rgba(0, 0, 0, 0)"
      || after.boxShadow !== "none" && after.boxShadow !== before.boxShadow || after.borderColor !== before.borderColor || after.backgroundColor !== before.backgroundColor;
    assert.ok(after.focused && after.visible && after.inViewport && painted, `${width}px ${label}: actual Tab focus is painted and in viewport: ${JSON.stringify({ before, after })}`);
    checks.push({ width, control: label, reachedBy: "Tab / Shift+Tab", passed: true, paint: after });
  }
  async function activate(target, label, key = "Enter") { await focus(target, label); await page.keyboard.press(key); }
  async function type(target, text, label) { await focus(target, label); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(text); }
  async function screenshot(stage) { const path = evidencePath(`keyboard-${width}-${++sequence}-${stage}.png`); await page.screenshot({ path, fullPage: true, caret: "initial" }); checks.push({ width, stage, screenshot: path, passed: true }); }
  async function restored(target, label) { checks.push({ width, check: `${label}: focus restored to opener`, passed: await target.evaluate(el => el === globalThis.document.activeElement) }); await focus(target, label); }
  async function native(target, label, type, accept, value) {
    await focus(target, label);
    const dialog = page.waitForEvent("dialog");
    const key = page.keyboard.press("Enter");
    const opened = await dialog;
    assert.equal(opened.type(), type);
    if (accept) await opened.accept(value); else await opened.dismiss();
    await key;
    checks.push({ width, action: label, nativeDialog: type, accepted: accept, scope: "Playwright dialog accept/dismiss API; not literal OS-level keyboard Escape or typing", passed: true });
  }
  async function navigate(name) {
    const menu = button(page, "Menu");
    if (await menu.isVisible()) await activate(menu, "Open operator navigation");
    await activate(page.getByRole("navigation", { name: "Operator navigation" }).filter({ visible: true }).getByRole("link", { name, exact: true }), `Navigate ${name}`);
    await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
    checks.push({ width, check: `${name} navigation leaves logical focus`, passed: await page.evaluate(() => globalThis.document.activeElement !== globalThis.document.body) });
  }
  return { focus, activate, type, screenshot, restored, native, navigate };
}
export async function get(page, origin, path) { const response = await page.request.get(origin + path); assert.equal(response.status(), 200, `GET ${path}`); return response.json(); }
export async function mutation(page, path, action, expected = 200) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() !== "GET");
  await action(); const result = await response; assert.equal(result.status(), expected, `${path}: ${await result.text()}`); return result;
}
