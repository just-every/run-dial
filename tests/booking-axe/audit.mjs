import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../scripts/evidence-path.mjs";

function publicErrorMessage(value) {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, text => {
    try { const url = new URL(text); return url.origin + url.pathname.replace(/(\/manage\/)(?:invite\/)?[^/]+/g, "$1[capability]"); }
    catch { return "[URL]"; }
  });
}
export function trackPage(page, errors, expectedResponses = new Map()) {
  page.setDefaultTimeout(30000);
  page.on("console", message => {
    const expected = expectedResponses.get(message.location().url);
    if (expected && message.text() === `Failed to load resource: the server responded with a status of ${expected} (${expected === 410 ? "Gone" : "Not Found"})`) return;
    if (message.type() === "error" || /hydration|did not match/i.test(message.text())) errors.push({ message: publicErrorMessage(message.text()), location: publicErrorMessage(message.location().url) }); });
  page.on("response", response => { if (response.status() === 404 && expectedResponses.get(response.url()) !== 404) errors.push({ message: "HTTP 404", location: publicErrorMessage(response.url()) }); });
  page.on("pageerror", error => errors.push({ message: publicErrorMessage(error.message) }));
}
export function auditor(page, width, scans) {
  return async stage => {
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.waitForFunction(() => globalThis.document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
    const result = await new AxeBuilder({ page }).analyze();
    const overflow = await page.evaluate(() => ({ viewport: globalThis.document.documentElement.clientWidth, document: globalThis.document.documentElement.scrollWidth, body: globalThis.document.body.scrollWidth, height: globalThis.document.documentElement.scrollHeight }));
    const screenshot = evidencePath(`booking-axe-${width}-${stage}.png`);
    scans.push({ width, stage, violations: result.violations, overflow, screenshot });
    // Caret hiding writes inline styles to every input, even before hydration.
    await page.screenshot({ path: screenshot, fullPage: true, caret: "initial" });
    assert.deepEqual(result.violations.filter(item => ["serious", "critical"].includes(item.impact)), [], `${width} ${stage}`);
    assert.ok(overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, `${width} ${stage} horizontal overflow: ${JSON.stringify(overflow)}`);
  };
}
/** Reach a real control through the tab order, then activate using the keyboard. */
export async function keyboardFocus(page, target) {
  for (let tabs = 0; tabs < 100; tabs++) {
    if (await target.evaluate(element => element === globalThis.document.activeElement)) {
      assert.ok(await target.evaluate(element => element.matches(":focus-visible")), "keyboard focus is visibly indicated");
      return;
    }
    await page.keyboard.press("Tab");
  }
  assert.fail("Control is unreachable in the keyboard tab order");
}

export async function keyboardActivate(page, target, key = "Enter") { await keyboardFocus(page, target); await page.keyboard.press(key); }
