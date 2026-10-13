import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditor, trackPage } from "./audit.mjs";

// HOME-001, DOCS-001 and BASE-PUBLIC-003: the Lobby a new install serves and every published
// docs page pass the axe audit at desktop and phone width, and a visit leaves nothing in browser storage.
const { sections } = JSON.parse(await readFile(new URL("../../docs/site.json", import.meta.url), "utf8"));
const docsPaths = sections.flatMap(section => section.pages).map(page => page.slug ? `/docs/${page.slug}` : "/docs");
export const publicSiteAudits = 2 * (1 + docsPaths.length);

async function assertNoStorage(page, where) {
  const kept = await page.evaluate(() => ({ local: globalThis.localStorage.length, session: globalThis.sessionStorage.length, cookie: globalThis.document.cookie }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "" }, `${where} keeps nothing in browser storage`);
}

export async function publicSiteJourney(browser, origin, scans, errors, widths = [1440, 390]) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 } });
    try {
      const page = await context.newPage(); trackPage(page, errors); const audit = auditor(page, width, scans);
      await page.goto(origin + "/"); await page.locator("h1").waitFor();
      assert.equal(await page.locator(".host-chip-link").count(), 0, "the Lobby has no booking-profile link");
      await audit("lobby-unclaimed");
      await page.mouse.wheel(0, 1600);
      await page.reload(); await page.locator("h1").waitFor();
      await assertNoStorage(page, "the Lobby after an attempted scroll and a reload");
      for (const path of docsPaths) {
        await page.goto(origin + path); await page.locator(".docs-prose").waitFor();
        await audit(`docs${path.slice(5).replaceAll("/", "-") || "-home"}`);
      }
      await page.mouse.wheel(0, 1200);
      await page.locator(".docs-pager-card").first().click(); await page.waitForURL(url => url.pathname !== docsPaths.at(-1));
      await page.reload(); await page.locator(".docs-prose").waitFor();
      await assertNoStorage(page, "the docs after a scroll, an in-page navigation and a reload");
    } finally { await context.close(); }
  }
}
