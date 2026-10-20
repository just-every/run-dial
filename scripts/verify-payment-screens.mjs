import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";

// PAY-001 browser proof on the review rig (Stripe synthetic at the HTTP edge): Settings connect, the event-type
// price field, the pay step, the payment return, the receipt, the manage page and the operator booking record
// at 1440 and 390 pixels. Run by the booking-axe rig with DIAL_PAYMENT_SCREENS set to the evidence folder.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752", folder = process.env.DIAL_PAYMENT_SCREENS;
assert.ok(folder, "DIAL_PAYMENT_SCREENS names the evidence folder");
await mkdir(folder, { recursive: true });
const webhookSecret = "whsec_wiretestonly", headers = { Origin: origin };
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext();
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin);
  assert.equal((await owner.request.post(origin + "/__fixtures/setup", { headers, data: {} })).status(), 200);
  const start = await owner.request.get(origin + "/api/app/payments/stripe/oauth/start", { maxRedirects: 0 });
  const state = new URL(start.headers().location).searchParams.get("state");
  assert.equal((await owner.request.get(`${origin}/api/payments/stripe/oauth/callback?code=wire-stripe-consent&state=${encodeURIComponent(state)}`, { maxRedirects: 0 })).status(), 302);
  const created = await owner.request.post(origin + "/api/app/event-types", { headers, data: { slug: "paid-session", title: "Paid strategy session", description: "A paid working session to plan your next quarter.", durationMinutes: 30, durationOptionsMinutes: [30, 60], color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })) } });
  assert.equal(created.status(), 201);
  const event = await created.json();
  assert.equal((await owner.request.put(`${origin}/api/app/event-types/${event.id}/price`, { headers, data: { amountCents: 5000, durationPrices: [{ durationMinutes: 60, amountCents: 9000 }] } })).status(), 200);
  assert.equal((await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`, { headers, data: {} })).status(), 200);
  const storageState = await owner.storageState();
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const slot = (await (await owner.request.get(`${origin}/api/public/book/dial-host/paid-session/availability?week=${future}&durationMinutes=60`)).json()).slots[0].startAt;
  const selection = await (await owner.request.post(`${origin}/api/public/book/dial-host/paid-session/selection`, { headers, data: { startAt: slot, inviteeTimezone: "America/New_York", durationMinutes: 60 } })).json();
  const details = `/book/dial-host/paid-session/details?${new URLSearchParams({ nonce: selection.nonce, startAt: slot, inviteeTimezone: "America/New_York", durationMinutes: "60" })}`;
  const shots = [];
  const capture = async (width, name, path, ready, session = false) => {
    const context = await browser.newContext({ ...(session ? { storageState } : {}), viewport: { width, height: width === 1440 ? 1024 : 844 }, timezoneId: "America/New_York" });
    try {
      const page = await context.newPage();
      await page.goto(origin + path);
      const target = await ready(page);
      await (target ?? page).screenshot({ path: `${folder}/${name}-${width}.png`, ...(target ? {} : { fullPage: true }), caret: "initial" });
      shots.push(`${name}-${width}.png`);
    } finally { await context.close(); }
  };
  for (const width of [1440, 390]) {
    await capture(width, "settings-stripe", "/app/settings", async page => { const card = page.locator("#stripe-connection"); await card.getByText("acct_wirehost").waitFor(); await card.getByRole("button", { name: "Disconnect Stripe" }).waitFor(); return card; }, true);
    await capture(width, "event-type-price", `/app/event-types/${event.id}`, async page => { const form = page.getByRole("form", { name: "Price" }); await form.getByLabel("Price for 60 minutes (USD)").waitFor(); for (let attempt = 0; await form.getByLabel("Price for 60 minutes (USD)").inputValue() !== "90.00"; attempt++) { assert.ok(attempt < 100, "the saved 60-minute price loads"); await page.waitForTimeout(100); } assert.equal(await form.getByLabel("Price (USD) for every duration").inputValue(), "50.00"); return form; }, true);
    await capture(width, "pay-step", details, async page => { await page.getByRole("button", { name: "Continue to payment · $90.00 USD" }).waitFor(); await page.getByText("Your time is held for 10 minutes", { exact: false }).waitFor(); });
  }
  // The invitee continues to Stripe; the slot is held and nothing is confirmed until Stripe's signed event.
  const step = await owner.request.post(`${origin}/api/public/book/dial-host/paid-session/confirm`, { headers, data: { nonce: selection.nonce, startAt: slot, durationMinutes: 60, inviteeTimezone: "America/New_York", name: "Avery Payer", email: "avery.payer@example.test", answers: {} } });
  assert.equal(step.status(), 202);
  const payment = (await step.json()).payment, returnPath = new URL(payment.returnUrl).pathname + new URL(payment.returnUrl).search;
  const sessionId = new URL(payment.checkoutUrl).pathname.split("/").at(-1);
  for (const width of [1440, 390]) await capture(width, "payment-return-waiting", `${returnPath}&session_id=${sessionId}`, async page => { await page.getByRole("heading", { name: "Waiting for Stripe to confirm your payment." }).waitFor(); });
  const paid = await (await owner.request.post(origin + "/__fixtures/payments/pay", { headers, data: { sessionId } })).json();
  const body = JSON.stringify({ id: "evt_screens_completed", object: "event", type: "checkout.session.completed", account: "acct_wirehost", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: paid } });
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal((await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex")}` }, data: body })).status(), 200);
  const status = await (await owner.request.get(`${origin}/api/public/payments/${new URL(payment.returnUrl).searchParams.get("return")}`)).json();
  assert.equal(status.state, "confirmed");
  const token = new URL(status.manageUrl).pathname.split("/").at(-1);
  for (const width of [1440, 390]) {
    await capture(width, "receipt", `/book/dial-host/paid-session/confirmed?token=${token}`, async page => { await page.getByText("Paid $90.00 USD", { exact: false }).waitFor(); await page.getByText(sessionId).waitFor(); });
    await capture(width, "manage", `/manage/${token}`, async page => { await page.getByText("No refund is issued by Dial", { exact: false }).waitFor(); await page.getByText(sessionId).waitFor(); });
    await capture(width, "booking-record", "/app/bookings?query=Avery%20Payer", async page => { await page.getByRole("heading", { name: "Avery Payer", exact: true }).waitFor(); await page.getByText("$90.00 USD paid through Stripe").waitFor(); }, true);
  }
  console.log(`PAY-001 browser proof: ${shots.length} screenshots (${shots.join(", ")}).`);
} finally { await owner.close(); await browser.close(); }
