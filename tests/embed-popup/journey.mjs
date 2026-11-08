import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { popupRuntime } from "./runtime.mjs";

const expect = baseExpect.configure({ timeout: 25_000 });
const framePath = (url, origin) => { try { return new URL(url, origin).pathname; } catch { return "unavailable"; } };
const question = "What would you like to discuss?";
const name = "Synthetic popup invitee";
const email = `synthetic-dial-popup${String.fromCharCode(64)}example.test`;

async function scan(page, label, screenshots) {
  const results = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(results.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id), [], `${label}: accessibility`);
  for (const frame of page.frames()) assert.equal(await frame.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false, `${label}: horizontal overflow`);
  await page.screenshot({ path: evidencePath(`${label}.png`), fullPage: true });
  screenshots.push(`${label}.png`);
}

export async function popupJourney(t) {
  const rig = await popupRuntime(t);
  const localChromium = process.env.CHROMIUM_PATH ?? await access("/usr/bin/chromium").then(() => "/usr/bin/chromium", () => undefined);
  const browser = await chromium.launch({ headless: true, ...(localChromium ? { executablePath: localChromium } : {}), args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  t.after(() => browser.close());
  const report = { runtime: "production Worker and native D1; separate parent site; no live provider", checks: [], screenshots: [] };
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(rig.parentOrigin.replace("localhost", "127.0.0.1"));
      const denied = page.waitForResponse(response => new URL(response.url()).pathname === "/embed/dial-host/intro");
      await page.getByRole("button", { name: "Book a time", exact: true }).click();
      const response = await denied;
      assert.equal(response.status(), 404, "an unallowlisted real parent cannot frame the booking document");
      assert.match(response.headers()["content-security-policy"], /frame-ancestors 'none'/);
      const body = await response.text();
      assert.ok(!body.includes("A focused introduction"));
      assert.ok(!body.includes('aria-label="Booking progress"'));
      assert.equal(response.headers()["set-cookie"], undefined);
      assert.equal((await rig.data("/__fixtures/status")).bookings.length, 0);
      report.checks.push({ unallowlistedParent: "404, frame-ancestors none, no booking content, cookies or writes" });
    } finally { await context.close(); }
  }
  for (const width of [1440, 390]) {
    for (const redirect of width === 1440 ? [true, false] : [true]) {
      await rig.call("/__fixtures/popup", { redirect }, 204);
      const before = await rig.data("/__fixtures/status");
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, timezoneId: "UTC" });
      const page = await context.newPage();
      page.setDefaultTimeout(25_000);
      const order = [], rawEvents = [], navigation = [], errors = [], thirdPartyCookies = [];
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.origin === rig.origin && response.headers()["set-cookie"]) thirdPartyCookies.push("Unexpected third-party Set-Cookie");
        if (url.origin === rig.origin && url.pathname === "/api/public/book/dial-host/intro/confirm" && response.request().method() === "POST" && response.status() === 201) order.push("committed");
      });
      page.on("pageerror", () => errors.push("Uncaught popup page error"));
      await page.exposeFunction("recordPopupEvent", detail => { order.push("booked"); rawEvents.push(detail); });
      await page.route("https://thanks.example.test/**", async route => {
        order.push("navigation"); navigation.push(route.request().url());
        await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><title>Booking received</title></head><body><main><h1>Booking received</h1></main></body></html>' });
      });
      try {
        await page.goto(rig.parentOrigin + "/?duplicate=yes");
        const launcher = page.getByRole("button", { name: "Book a time", exact: true });
        await expect(launcher).toHaveCount(1);
        await expect(page.locator("iframe")).toHaveCount(0);
        if (redirect) await scan(page, `popup-${width}-launcher`, report.screenshots);
        await launcher.focus(); await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Schedule a time", exact: true });
        await expect(dialog).toBeVisible();
        const close = dialog.getByRole("button", { name: /^Close/ });
        await expect(close).toBeFocused();
        const frame = page.frameLocator("dialog iframe");
        await expect(frame.locator(".pb-slot-button").first()).toBeVisible();
        await expect(frame.locator(".pb-slot-button").first()).toBeEnabled();
        if (width === 1440) {
        await page.evaluate(() => { const script = globalThis.document.querySelector('script[data-dial-mode="popup"]'); const repeat = script.cloneNode(true); delete repeat.dataset.dialMounted; globalThis.document.body.append(repeat); });
        await expect(launcher).toHaveCount(1);
        await expect(page.locator("dialog iframe")).toHaveCount(1);
        await close.press("Shift+Tab");
        assert.equal(await page.evaluate(() => globalThis.document.activeElement === globalThis.document.querySelector("#outside")), false, "backward Tab stays in modal");
        await close.focus(); await close.press("Tab");
        await expect.poll(() => page.evaluate(() => globalThis.document.activeElement?.tagName), { message: "forward Tab enters the booking frame" }).toBe("IFRAME");
        await page.locator("#outside").evaluate(element => element.focus());
        assert.equal(await page.evaluate(() => globalThis.document.activeElement === globalThis.document.querySelector("#outside")), false, "the parent remains inert while popup is open");
        // Native dialog keyboard dismissal must also work while focus is inside its booking frame.
        await expect(frame.locator(".pb-slot-button").first()).toBeEnabled();
        await frame.locator(".pb-slot-button").first().focus();
        assert.equal(await page.evaluate(() => globalThis.document.activeElement?.tagName), "IFRAME", "Escape starts inside the booking frame");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused();
        await launcher.press("Space"); await expect(dialog).toBeVisible();
        await close.click(); await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused();
        await launcher.press("Enter"); await expect(dialog).toBeVisible();
        await expect(frame.locator(".pb-slot-button").first()).toBeVisible();
        }
        // Book next week so browser work cannot cross the selected slot's start boundary.
        const firstStart = await frame.locator(".pb-slot-button").first().getAttribute("data-start-at");
        const nextWeek = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/book/dial-host/intro/availability");
        await frame.getByRole("button", { name: "Next week", exact: true }).click(); await nextWeek;
        await expect(frame.locator(".pb-slot-button").first()).not.toHaveAttribute("data-start-at", firstStart);
        await expect(frame.locator(".pb-slot-button").first()).toBeEnabled();
        if (redirect) {
          await scan(page, `popup-${width}-picker`, report.screenshots);
          if (width === 1440) {
          // A real foreign-origin sender and a real same-origin sibling frame have no launcher authority.
          await page.evaluate(() => {
            globalThis.postMessage({ type: "dial:booked", bookingReference: "synthetic-dial-forged", redirectUrl: "https://thanks.example.test/forged" }, globalThis.location.origin);
            globalThis.postMessage({ type: "dial:close" }, globalThis.location.origin);
          });
          await page.evaluate(async origin => {
            const sibling = globalThis.document.createElement("iframe"); sibling.name = "unmanaged-popup-frame"; sibling.hidden = true;
            sibling.src = origin + "/embed/dial-host/intro?parent=" + encodeURIComponent(globalThis.location.origin);
            await new Promise(done => { sibling.onload = done; globalThis.document.body.append(sibling); });
          }, rig.origin);
          const sibling = page.frame({ name: "unmanaged-popup-frame" });
          await sibling.evaluate(() => {
            globalThis.parent.postMessage({ type: "dial:booked", bookingReference: "synthetic-dial-sibling", redirectUrl: "https://thanks.example.test/forged" }, "*");
            globalThis.parent.postMessage({ type: "dial:close" }, "*");
          });
          await page.evaluate(() => new Promise(done => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done))));
          assert.deepEqual(rawEvents, []); assert.deepEqual(navigation, []); await expect(dialog).toBeVisible();
          await page.evaluate(() => globalThis.document.querySelector('iframe[name="unmanaged-popup-frame"]').remove());
          }
        }
        const selectedStart = await frame.locator(".pb-slot-button").first().getAttribute("data-start-at");
        await frame.locator(".pb-slot-button").first().click();
        await expect(frame.getByLabel("Name", { exact: true })).toHaveValue(name);
        await expect(frame.getByLabel("Email", { exact: true })).toHaveValue(email);
        await frame.getByLabel(question, { exact: false }).fill("Synthetic popup booking goals");
        if (redirect) await scan(page, `popup-${width}-details`, report.screenshots);
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/book/dial-host/intro/confirm" && response.request().method() === "POST");
        await frame.getByRole("button", { name: "Confirm booking", exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 201, "popup uses the production confirmation claim");
        const originalInput = response.request().postDataJSON();
        // Both receipt and parent navigation can release Chromium's original response body.
        // Read the committed result through the native replay door without slowing either navigation.
        const replay = await context.request.post(rig.origin + "/api/public/book/dial-host/intro/confirm", { headers: { origin: rig.origin }, data: originalInput });
        assert.equal(replay.status(), 200, "native replay returns the committed receipt after the browser confirms");
        const confirmation = await replay.json();
        await expect.poll(() => rawEvents.length).toBe(1);
        if (redirect) {
          await expect(page.getByRole("heading", { name: "Booking received", exact: true })).toBeVisible();
          assert.equal(navigation.length, 1);
          const target = new URL(navigation[0]);
          assert.equal(target.protocol, "https:"); assert.equal(target.pathname, "/complete");
          assert.equal(target.searchParams.get("event"), "A focused introduction");
          assert.equal(Date.parse(target.searchParams.get("start_time")), Date.parse(selectedStart));
          assert.equal(target.searchParams.get("name"), name); assert.equal(target.searchParams.get("utm_source"), "synthetic-dial-campaign");
          assert.equal(target.searchParams.get("booking_reference"), confirmation.bookingReference);
          assert.deepEqual([...target.searchParams.keys()].sort(), ["booking_reference", "event", "name", "start_time", "utm_source"]);
          assert.ok(!navigation[0].includes(originalInput.nonce));
          assert.ok(!navigation[0].includes(new URL(confirmation.manageUrl).pathname.split("/").at(-1)));
          assert.deepEqual(order, ["committed", "booked", "navigation"], "exactly one HTTPS parent navigation follows the booked event");
        } else {
          await expect(frame.getByRole("heading", { name: "Booking confirmed.", exact: true })).toBeVisible();
          await expect(frame.getByRole("link", { name: "Manage booking", exact: true })).toBeVisible();
          const managedFrame = page.frames().find(item => item.parentFrame() === page.mainFrame());
          await managedFrame.evaluate(reference => {
            globalThis.parent.postMessage({ type: "dial:booked", bookingReference: reference }, "*");
            globalThis.parent.postMessage({ type: "dial:booked", bookingReference: reference, redirectUrl: "https://thanks.example.test/replay" }, "*");
          }, confirmation.bookingReference);
          await managedFrame.goto(managedFrame.url());
          await expect(frame.getByRole("heading", { name: "Booking confirmed.", exact: true })).toBeVisible();
          assert.deepEqual(order, ["committed", "booked"], "receipt reads and message or confirmation replay never repeat a parent event or navigate");
          assert.deepEqual(navigation, []); assert.equal(page.url(), rig.parentOrigin + "/?duplicate=yes");
          await scan(page, `popup-${width}-receipt`, report.screenshots);
        }
        await expect.poll(() => rawEvents.length).toBe(1);
        assert.deepEqual(rawEvents, [{ bookingReference: confirmation.bookingReference }], "the parent event is capability-free");
        const after = await rig.data("/__fixtures/status");
        assert.equal(after.bookings.length, before.bookings.length + 1);
        assert.equal(after.bookings.filter(item => item.id === confirmation.bookingReference).length, 1);
        assert.equal(after.bookings.find(item => item.id === confirmation.bookingReference).calendar_required, 0, "the popup booked without a connected calendar");
        assert.equal(after.booking_occurrences.length, before.booking_occurrences.length + 1);
        assert.equal(after.delivery_outbox.filter(item => item.kind.startsWith("calendar_")).length, 0);
        assert.equal(after.fixture_activity.filter(item => ["busy", "check", "upsert", "cancel"].includes(item.kind)).length, before.fixture_activity.filter(item => ["busy", "check", "upsert", "cancel"].includes(item.kind)).length);
        assert.deepEqual(await context.cookies(rig.origin), [], "booking iframe sets no third-party cookie");
        assert.deepEqual(thirdPartyCookies, [], "production iframe responses never set third-party cookies");
        assert.deepEqual(errors, []);
        report.checks.push({ width, redirect, bookingCountDelta: 1, eventCount: rawEvents.length, parentNavigations: navigation.length, nativeReplay: true, messageReplay: !redirect, cookies: 0, keyboard: width === 1440 ? "open, close, frame Escape, focus containment and return" : "phone booking smoke" });
      } catch (error) {
        const texts = await Promise.all(page.frames().map(async item => ({ url: framePath(item.url(), rig.origin), text: (await item.locator("body").innerText().catch(() => "unavailable")).slice(0, 1200) })));
        await page.screenshot({ path: evidencePath("popup-failure.png"), fullPage: true }).catch(() => {});
        throw new Error(error.message + "\nFrame diagnostics: " + JSON.stringify(texts), { cause: error });
      } finally { await context.close(); }
    }
  }
  await writeFile(evidencePath("embed-popup-receipt.json"), JSON.stringify(report, null, 2) + "\n");
}
