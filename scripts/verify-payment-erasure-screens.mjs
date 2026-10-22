import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { cancellationMailScreens } from "./payment-cancellation-mail-screens.mjs";

const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const folder = process.env.DIAL_ERASURE_SCREENS; assert.ok(folder); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext(), headers = { Origin: origin };
const json = async (response, status = 200) => { assert.equal(response.status(), status, `native HTTP ${response.status()}`); return response.json(); };
const post = async (path, data, status = 200) => json(await owner.request.post(origin + path, { headers, data }), status);
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin); await post("/__fixtures/setup", {});
  await owner.request.post(origin + "/__fixtures/payments/connect", { headers, data: { accountId: "acct_wirehost" } });
  const event = await post("/api/app/event-types", { slug: "synthetic-dial-erasure", title: "Strategy consultation", description: "A focused hour to work through your plan.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/consultation", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/price`, { headers, data: { amountCents: 21775, durationPrices: [] } }));
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: null, lateCancelFeeCents: 0, noShowFeeCents: 3000 } }));
  await post(`/api/app/event-types/${event.id}/publish`, {});
  for (const width of [1440, 390]) {
    const email = `synthetic-dial-erasure-${width}@example.test`, base = `/api/public/book/dial-host/${event.slug}`;
    const week = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
    const startAt = (await json(await owner.request.get(`${origin}${base}/availability?week=${week}&durationMinutes=60`))).slots[0].startAt;
    const selection = await post(base + "/selection", { startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
    const shown = (await json(await owner.request.get(`${origin}${base}/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`))).payment;
    const step = await post(base + "/confirm", { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", durationMinutes: 60, name: "Avery Consultation", email, answers: {}, cardConsent: { accepted: true, version: shown.consent.version } }, 202);
    const paid = await post("/__fixtures/payments/pay", { sessionId: new URL(step.payment.checkoutUrl).pathname.split("/").at(-1) });
    const page = await owner.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message)); await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto(origin + "/app/settings"); await page.waitForLoadState("networkidle");
      assert.deepEqual(errors, [], "the settings page hydrates without errors");
      const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Erase personal data", exact: true }) });
      await card.getByLabel("Person’s email").fill(email);
      const previewed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/privacy/preview");
      await card.getByRole("button", { name: "Preview erasure", exact: true }).click();
      assert.equal((await previewed).status(), 200);
      await expect(card.getByRole("button", { name: "Confirm permanent erasure", exact: true })).toBeVisible();
      await expect(card.getByText(/1 pending Checkout payment will be closed/)).toBeVisible();
      await shot(page, card, width, "payment-erasure-preview");
      await card.getByRole("button", { name: "Confirm permanent erasure", exact: true }).click();
      await expect(card.getByText("Stripe Checkout sessions kept: 1.", { exact: true })).toBeVisible();
      await expect(card.getByText(/Saved cards: 1 detached at Stripe, 0 not detached/)).toBeVisible();
      await shot(page, card, width, "payment-erasure-complete");
      // A late signed event never brings back the erased booking.
      const body = JSON.stringify({ id: `synthetic-dial-${randomUUID()}`, type: "checkout.session.completed", account: "acct_wirehost", data: { object: paid } });
      const timestamp = Math.floor(Date.now() / 1000), signature = createHmac("sha256", "whsec_wiretest").update(`${timestamp}.${body}`).digest("hex");
      assert.equal((await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "stripe-signature": `t=${timestamp},v1=${signature}`, "content-type": "application/json" }, data: body })).status(), 200);
      assert.equal((await json(await owner.request.get(origin + "/api/app/bookings"))).some(row => row.inviteeEmail === email), false);
    } catch (error) { console.log("Settings diagnostics", JSON.stringify({ errors, alerts: await page.getByRole("alert").allTextContents() })); await page.screenshot({ path: `${folder}/failed-${width}.png`, fullPage: true }); throw error; }
    finally { await page.close(); }
  }
  await cancellationMailScreens({ browser, owner, origin, folder, event });
  console.log("Payment erasure preview, completed receipt and cancellation email passed at 1440 and 390.");
} finally { await owner.close(); await browser.close(); }

async function shot(page, card, width, name) {
  await card.scrollIntoViewIfNeeded(); await page.evaluate(() => globalThis.document.fonts.ready);
  assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1));
  await card.screenshot({ path: `${folder}/${name}-${width}.png` });
}
