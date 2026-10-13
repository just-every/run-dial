import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { identityEvidence } from "./identity-evidence.mjs";

export async function securityJourney(page, origin, eventId) {
  const endpoint = `${origin}/api/app/event-types/${eventId}/copy-report`, url = origin + "/book/fresh-host/first-event";
  const headers = { Origin: origin, "X-Dial-Copy-Report": "1" };
  const snapshot = () => page.request.get(origin + "/__host/reports").then(r => r.json());
  const before = await snapshot();
  for (const [body, extra, expected] of [
    [{ url }, { Origin: "https://foreign.example.test" }, 403],
    [{ url }, { Origin: "" }, 403],
    [{ url }, { "X-Dial-Copy-Report": "" }, 403],
    [{ url }, { "sec-fetch-site": "cross-site" }, 403],
    [{ url, acceptedAt: "2000-01-01T00:00:00Z" }, {}, 400],
    [{ url: origin + "/book/wrong/old" }, {}, 409],
  ]) {
    assert.equal((await page.request.post(endpoint, { data: body, headers: { ...headers, ...extra } })).status(), expected);
    assert.deepEqual(await snapshot(), before, "rejected report changes no durable copy record");
  }
  assert.equal((await page.request.post(`${origin}/api/app/event-types/00000000000000000000000000/copy-report`, { data: { url }, headers })).status(), 404);
  assert.equal((await fetch(endpoint, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ url }) })).status, 401);
  const current = await (await page.request.get(origin + `/api/app/event-types/${eventId}`)).json();
  const response = await page.request.post(origin + "/api/app/event-types", { data: { ...current, slug: "private-draft" }, headers }); assert.equal(response.status(), 201);
  const draft = await response.json();
  assert.equal((await page.request.post(origin + `/api/app/event-types/${draft.id}/copy-report`, { data: { url: origin + "/book/fresh-host/private-draft" }, headers })).status(), 409);
  assert.equal((await page.request.post(origin + `/api/app/event-types/${draft.id}/${current.requestOnly ? "open-requests" : "publish"}`, { headers })).status(), 200);
  assert.equal((await page.request.post(origin + `/api/app/event-types/${draft.id}/copy-report`, { data: { url }, headers })).status(), 409, "another published event cannot report the first event URL");
  await page.request.post(origin + `/api/app/event-types/${draft.id}/disable`, { headers });
  assert.equal((await page.request.post(origin + `/api/app/event-types/${draft.id}/copy-report`, { data: { url: origin + "/book/fresh-host/private-draft" }, headers })).status(), 409);
  await page.request.delete(origin + `/api/app/event-types/${draft.id}`, { headers });
  assert.deepEqual(await snapshot(), before);
  const missingPublication = await page.request.post(origin + `/api/app/event-types/${draft.id}/publish`, { headers });
  assert.equal(missingPublication.status(), 404);
  assert.deepEqual((await missingPublication.json()).error.details, ["event_not_found"]);
}

export async function clipboardJourney({ browser, page, context, origin, eventId, requestsOnly, scan }) {
  const expected = origin + "/book/fresh-host/first-event", endpoint = `**/api/app/event-types/${eventId}/copy-report`;
  const share = page.locator("section").filter({ has: page.getByRole("heading", { name: "Share this event", exact: true }) });
  const copy = share.getByRole("button", { name: "Copy booking link", exact: true });
  let posts = 0; const listener = request => { if (request.url().endsWith(`/${eventId}/copy-report`) && request.method() === "POST") posts++; }; page.on("request", listener);
  await page.evaluate(() => { globalThis.savedClipboardWrite = globalThis.navigator.clipboard.writeText.bind(globalThis.navigator.clipboard); Object.defineProperty(globalThis.navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new Error("denied by test"); } }); });
  await copy.click(); await expect(share.getByRole("status")).toContainText("could not be copied"); assert.equal(posts, 0);
  await page.evaluate(() => { Object.defineProperty(globalThis.navigator.clipboard, "writeText", { configurable: true, value: globalThis.savedClipboardWrite }); });
  await page.route(endpoint, route => route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Completion temporarily unavailable." } } }));
  await copy.click(); await expect(share.getByRole("status")).toContainText("completion could not be saved");
  assert.equal((await (await page.request.get(origin + "/api/app/host-setup")).json()).links[0].copiedAt, null);
  await page.unroute(endpoint);
  await page.evaluate(() => { Object.defineProperty(globalThis.navigator.clipboard, "writeText", { configurable: true, value: async value => { await globalThis.savedClipboardWrite(value); await new Promise(resolve => { globalThis.releaseClipboardReport = resolve; }); } }); });
  const before = posts; await copy.click(); await page.waitForFunction(() => typeof globalThis.releaseClipboardReport === "function"); assert.equal(posts, before, "POST waits for clipboard promise resolution");
  await page.evaluate(() => globalThis.releaseClipboardReport()); await expect(share.getByRole("status")).toHaveText("Booking link copied."); assert.equal(posts, before + 1);
  assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), expected);
  await page.evaluate(() => { delete globalThis.navigator.clipboard.writeText; delete globalThis.savedClipboardWrite; delete globalThis.releaseClipboardReport; });
  page.off("request", listener);
  const fresh = await browser.newContext({ storageState: await context.storageState(), viewport: page.viewportSize() });
  try { const freshPage = await fresh.newPage(); await freshPage.goto(origin + "/app"); const state = await (await freshPage.request.get(origin + "/api/app/host-setup")).json(); assert.ok(state.links[0].copiedAt); await freshPage.reload(); assert.ok((await (await freshPage.request.get(origin + "/api/app/host-setup")).json()).links[0].copiedAt); } finally { await fresh.close(); }
  await page.goto(origin + "/setup/event-types");
  await page.getByRole("main").getByRole("button", { name: "Copy booking link", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Booking link copied.");
  assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), expected);
  await page.goto(origin + "/setup");
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await page.waitForURL(origin + "/app");
  await page.goto(origin + "/setup"); await page.waitForURL(origin + "/app");
  await expect(page.getByText("0 bookings", { exact: true })).toBeVisible();
  await expect(page.getByText("0 requests", { exact: true })).toBeVisible();
  const mobile = page.viewportSize().width === 390;
  if (mobile) { const menu = page.getByRole("button", { name: "Menu", exact: true }); await menu.click(); await page.keyboard.press("Escape"); await expect(menu).toBeFocused(); await expect(page.locator("#operator-mobile-navigation")).toHaveCount(0); }

  if (mobile) await page.getByRole("button", { name: "Menu", exact: true }).click();
  const navigation = page.locator(mobile ? "#operator-mobile-navigation" : "aside");
  await navigation.getByRole("button", { name: "Copy booking link", exact: true }).click();
  await expect(navigation.getByRole("status")).toHaveText("Booking link copied.");
  assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), expected);
  if (mobile) await page.keyboard.press("Escape");
  await scan("event-links");
  await page.goto(origin + `/app/event-types/${eventId}`);
  await expect(page.getByRole("button", { name: "Copy embed code (inline)", exact: true })).toBeVisible();
  const publicPage = await context.newPage();
  try { await publicPage.goto(expected); if (requestsOnly) { await expect(publicPage.getByRole("heading", { name: "Request a time with Fresh Host.", exact: true })).toBeVisible(); await expect(publicPage.locator(".pb-event-flow").getByRole("heading", { name: "First event", exact: true })).toBeVisible(); assert.equal(await publicPage.locator(".pb-slot-button").count(), 0); } else await expect(publicPage.locator(".pb-slot-button").first()).toBeVisible(); } finally { await publicPage.close(); }
  await page.bringToFront();
  const snippets = {};
  for (const mode of ["inline", "modal"]) {
    await page.getByRole("button", { name: `Copy embed code (${mode})`, exact: true }).click(); await expect(share.getByRole("status").filter({ hasText: "embed copied." })).toBeVisible();
    snippets[mode] = await page.evaluate(() => globalThis.navigator.clipboard.readText());
    const script = `<script async src="${origin}/embed/dial.js" data-dial-handle="fresh-host" data-dial-embed="first-event" data-dial-mode="${mode}"></script>`;
    assert.equal(snippets[mode], mode === "inline" ? script : '<button type="button" data-dial-embed="first-event">Book a time</button>\n' + script);
  }
  const host = createServer((request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html lang="en"><head><title>Embed host</title></head><body><main>${snippets[request.url === "/modal" ? "modal" : "inline"]}</main></body></html>`); });
  await new Promise((resolve, reject) => { host.once("error", reject); host.listen(0, "127.0.0.1", resolve); });
  try {
    const hostOrigin = `http://127.0.0.1:${host.address().port}`;
    assert.equal((await page.request.put(origin + "/api/app/embed-settings", { headers: { Origin: origin }, data: { allowedOrigins: [hostOrigin] } })).status(), 200);
    const embedded = await context.newPage();
    const identities = [], failures = [];
    try {
      for (const mode of ["inline", "modal"]) {
        const loaded = embedded.waitForResponse(response => new URL(response.url()).pathname === "/embed/fresh-host/first-event" && response.request().isNavigationRequest());
        await embedded.goto(`${hostOrigin}/${mode}`);
        if (mode === "modal") await embedded.getByRole("button", { name: "Book a time", exact: true }).click();
        await expect(embedded.locator("iframe")).toBeVisible();
        const frame = embedded.frameLocator("iframe");
        await expect(frame.locator("h1")).toContainText(requestsOnly ? "Request a time" : "Choose a day and time.");
        const response = await loaded;
        const initial = await identityEvidence(embedded, response, "First event");
        const document = await (await embedded.locator("iframe").elementHandle()).contentFrame();
        await document.waitForFunction(() => globalThis.getComputedStyle(globalThis.document.querySelector(".pb-event-layout")).display === "grid");
        const screenshot = evidencePath(`host-identity-${requestsOnly ? "requests" : "published"}-${page.viewportSize().width}-${mode}.png`);
        // Capturing SSR must not add caret styles before React hydrates.
        await embedded.screenshot({ path: screenshot, fullPage: true, caret: "initial" });
        identities.push({ mode, requestsOnly, initial, screenshot, ...await identityEvidence(embedded, response, "First event") });
        try {
          const identity = requestsOnly ? frame.locator(".pb-event-flow").getByRole("heading", { name: "First event", exact: true }) : frame.locator(".pb-event-flow").getByText("First event · 30 minutes", { exact: true });
          await expect(identity).toBeVisible();
          if (requestsOnly) {
            await expect(frame.getByText("Requests only", { exact: true })).toBeVisible();
            await expect(frame.getByText("Automatic booking is not open. Calendar availability has not been verified for this event. Your request goes to the host for review; it does not reserve a time or create a booking.", { exact: true })).toBeVisible();
            assert.equal(await frame.locator(".pb-slot-button").count(), 0);
            await expect(frame.getByRole("link", { name: "Send another request", exact: true })).toHaveAttribute("href", `/embed/fresh-host/first-event/request?parent=${encodeURIComponent(hostOrigin)}#dial-parent=${encodeURIComponent(hostOrigin)}`);
          }
        }
        catch (error) { failures.push(new Error(`${mode} event identity at ${page.viewportSize().width}px: ${error.message}`)); }
      }
      assert.deepEqual(failures.map(error => error.message), [], "each embed mode visibly identifies its event");
    } finally {
      await writeFile(evidencePath(`host-identity-${requestsOnly ? "requests" : "published"}-${page.viewportSize().width}.json`), JSON.stringify(identities, null, 2));
      await embedded.close();
    }
    const denied = await page.request.get(origin + "/embed/fresh-host/first-event?parent=" + encodeURIComponent("https://denied.example.test")); assert.equal(denied.status(), 404); assert.match(denied.headers()["content-security-policy"], /frame-ancestors 'none'/); assert.doesNotMatch(await denied.text(), /First event|Fresh Host/);
  } finally { await new Promise(resolve => host.close(resolve)); }
  await page.bringToFront(); await scan("sharing");
}
