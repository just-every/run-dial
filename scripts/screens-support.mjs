import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

/** Browser proof helpers for clause screens: a fresh owner context, then one screenshot and one axe scan per page and width. */
export const widths = [1440, 390];

export async function screenshotFolder(variable) {
  const folder = process.env[variable];
  assert.ok(folder, `${variable} names the evidence folder`);
  await mkdir(folder, { recursive: true });
  return folder;
}

export function screenRecorder({ browser, origin, folder, storageState, timezoneId = "America/New_York" }) {
  const shots = [];
  async function capture(width, name, path, ready, { session = true, setup } = {}) {
    const context = await browser.newContext({ ...(session ? { storageState } : {}), viewport: { width, height: width === 1440 ? 1024 : 844 }, timezoneId });
    try {
      const page = await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydrat/iu.test(message.text()))errors.push(message.text());});
      if (setup) await setup(page);
      await page.goto(origin + path);
      const target = await ready(page);
      await page.evaluate(() => globalThis.document.fonts.ready);
      const result = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(result.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => `${item.id}: ${item.nodes.map(node => node.target.join(" ")).join(" | ")}`), [], `${name} at ${width} has no serious axe finding`);
      const overflow = await page.evaluate(() => ({ viewport: globalThis.document.documentElement.clientWidth, document: globalThis.document.documentElement.scrollWidth }));
      assert.ok(overflow.document <= overflow.viewport + 1, `${name} at ${width} has no horizontal overflow: ${JSON.stringify(overflow)}`);
      await (target ?? page).screenshot({ path: `${folder}/${name}-${width}.png`, ...(target ? {} : { fullPage: true }), caret: "initial" });
      assert.deepEqual(errors,[],`${name} at ${width} has no page error or hydration mismatch`);
      shots.push(`${name}-${width}.png`);
    } finally { await context.close(); }
  }
  return { capture, shots };
}
