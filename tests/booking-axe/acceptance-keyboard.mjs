import assert from "node:assert/strict";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { keyboardFocus } from "./audit.mjs";

/** One-off evidence of tab order and actually painted focus for new controls. */
export async function keyboardControls(page, controls, stage, width, checks) {
  const order = [];
  let previous;
  for (const [name, control] of controls) {
    await control.waitFor({ state: "visible" });
    assert.equal(await control.isEnabled(), true, `${name} is enabled`);
    if (previous) {
      const preceding = await control.evaluate((element, prior) => Boolean(prior.compareDocumentPosition(element) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING), await previous.elementHandle());
      assert.ok(preceding, `${name}: controls follow document order`);
    }
    const before = await control.evaluate(paint);
    await keyboardFocus(page, control);
    // Reading computed style starts any focus transition. Measure its final
    // paint, rather than the zero-duration instant immediately after Tab.
    await control.evaluate(paint);
    await control.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined)));
    });
    const focused = await control.evaluate(paint);
    const visiblyPainted = focused.outlineStyle !== "none" && parseFloat(focused.outlineWidth) > 0
      || focused.boxShadow !== "none" && focused.boxShadow !== before.boxShadow
      || focused.borderColor !== before.borderColor || focused.backgroundColor !== before.backgroundColor;
    const screenshot = evidencePath(`acceptance-focus-${stage}-${width}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, caret: "initial" });
    checks.push({ check: `Keyboard ${stage} ${name} at ${width}px`, passed: visiblyPainted, focusVisible: true, screenshot, focusedPaint: focused });
    assert.ok(visiblyPainted, `${stage} ${name}: keyboard focus has a painted indication`);
    order.push(name); previous = control;
  }
  checks.push({ check: `Keyboard focus order ${stage} at ${width}px`, passed: true, reachedByTab: order });
}

/** Chromium native confirm dialogs expose cancellation through Playwright's
 * dialog API; dismissal is the native Escape/cancel result, not a DOM modal. */
export async function dismissNativeConfirmation(page, trigger, name, checks) {
  await keyboardFocus(page, trigger);
  const response = new Promise(resolve => page.once("dialog", async dialog => {
    assert.equal(dialog.type(), "confirm");
    await dialog.dismiss(); resolve();
  }));
  await Promise.all([response, page.keyboard.press("Enter")]);
  assert.ok(await trigger.isVisible(), "cancelled deletion leaves its field available");
  checks.push({ check: `Keyboard ${name}: native confirm cancellation preserves field`, passed: true, scope: "Playwright native dialog dismissal; native Escape/cancel semantics; no DOM dialog introduced" });
}

function paint(element) {
  const style = globalThis.getComputedStyle(element);
  return Object.fromEntries(["outlineStyle", "outlineWidth", "outlineColor", "boxShadow", "borderColor", "backgroundColor"].map(name => [name, style[name]]));
}
