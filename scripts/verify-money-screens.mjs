import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { screenRecorder, screenshotFolder, widths } from "./screens-support.mjs";

// PAY-003 browser proof on the review rig, with Stripe synthetic at the HTTP edge: the event type's deposit and
// cancellation policy, the pay step with its consent (and the refusal without it), the manage page's balance, the
// balance link due, paid and invalid, the booking record's payments with the refund form and a refused refund, and
// the receipt after a refund, at 1440 and 390 pixels with axe. Run with DIAL_MONEY_SCREENS set to the evidence folder.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752", folder = await screenshotFolder("DIAL_MONEY_SCREENS"), headers = { Origin: origin };
const webhookSecret = "whsec_wiretest";
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext();
const json = async (response, expected = 200) => { assert.equal(response.status(), expected, await response.text()); return response.json(); };
const webhook = async object => {
  const body = JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event", type: "checkout.session.completed", account: "acct_wirehost", livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal((await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex")}` }, data: body })).status(), 200);
};
const pay = async checkoutUrl => webhook(await json(await owner.request.post(origin + "/__fixtures/payments/pay", { headers, data: { sessionId: new URL(checkoutUrl).pathname.split("/").at(-1) } })));
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin);
  await json(await owner.request.post(origin + "/__fixtures/setup", { headers, data: {} }));
  const start = await owner.request.get(origin + "/api/app/payments/stripe/oauth/start", { maxRedirects: 0 });
  assert.equal((await owner.request.get(`${origin}/api/payments/stripe/oauth/callback?code=wire-stripe-consent&state=${encodeURIComponent(new URL(start.headers().location).searchParams.get("state"))}`, { maxRedirects: 0 })).status(), 302);
  const event = await json(await owner.request.post(origin + "/api/app/event-types", { headers, data: { slug: "coaching", title: "Coaching session", description: "A focused hour to work through your plan.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) } }), 201);
  const { capture, shots } = screenRecorder({ browser, origin, folder, storageState: await owner.storageState() });
  const termsForm = async (page, deposit) => { const form = page.getByRole("form", { name: "Deposits and cancellation policy" }); await form.getByRole("button", { name: "Save payment terms" }).waitFor(); for (let attempt = 0; deposit && await form.getByLabel("Deposit (USD)").inputValue().catch(() => "") !== deposit; attempt++) { assert.ok(attempt < 100, "the saved deposit loads"); await page.waitForTimeout(100); } await form.scrollIntoViewIfNeeded(); return form; };
  for (const width of widths) await capture(width, "event-terms-empty", `/app/event-types/${event.id}`, page => termsForm(page));
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/price`, { headers, data: { amountCents: 10000, durationPrices: [] } }));
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: { deposit: { kind: "fixed", amountCents: 2500 }, balanceDueHours: 24, freeWindowHours: 48, lateCancelFeeCents: 4000, noShowFeeCents: 6000 } }));
  await json(await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`, { headers, data: {} }));
  for (const width of widths) await capture(width, "event-terms", `/app/event-types/${event.id}`, page => termsForm(page, "25.00"));

  const week = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const slot = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/availability?week=${week}&durationMinutes=60`))).slots[0].startAt;
  const selection = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/selection`, { headers, data: { startAt: slot, inviteeTimezone: "America/New_York", durationMinutes: 60 } }), 201);
  const details = `/book/dial-host/coaching/details?${new URLSearchParams({ nonce: selection.nonce, startAt: slot, inviteeTimezone: "America/New_York", durationMinutes: "60" })}`;
  for (const width of widths) {
    await capture(width, "pay-step-deposit", details, async page => { await page.getByRole("checkbox", { name: /I agree that Stripe saves my card/u }).waitFor(); await page.getByRole("button", { name: "Continue to payment · $25.00 USD" }).waitFor(); }, { session: false });
    await capture(width, "pay-step-consent-required", details, async page => {
      await page.getByLabel("Name").fill("Avery Deposit"); await page.getByLabel("Email").fill("avery.deposit@example.test");
      await page.getByRole("button", { name: "Continue to payment · $25.00 USD" }).click();
      await page.getByText("Agree to the saved card and the stated fees to book this event.").waitFor();
    }, { session: false });
  }
  const shown = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/selection?${new URLSearchParams({ nonce: selection.nonce, startAt: slot, inviteeTimezone: "America/New_York" })}`))).payment;
  const step = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/confirm`, { headers, data: { nonce: selection.nonce, startAt: slot, durationMinutes: 60, inviteeTimezone: "America/New_York", name: "Avery Deposit", email: "avery.deposit@example.test", answers: {}, cardConsent: { accepted: true, version: shown.consent.version } } }), 202);
  await pay(step.payment.checkoutUrl);
  const status = await json(await owner.request.get(`${origin}/api/public/payments/${new URL(step.payment.returnUrl).searchParams.get("return")}`));
  assert.equal(status.state, "confirmed");
  const token = new URL(status.manageUrl).pathname.split("/").at(-1);
  const balance = new URL((await json(await owner.request.get(`${origin}/api/public/manage/${token}`))).payment.balanceUrl).pathname;
  for (const width of widths) {
    await capture(width, "manage-balance-due", `/manage/${token}`, async page => { await page.getByRole("link", { name: "Pay the balance" }).waitFor(); await page.getByRole("region", { name: "Cancellation policy" }).waitFor(); }, { session: false });
    await capture(width, "balance-due", balance, async page => { await page.getByRole("button", { name: "Pay the balance · $75.00 USD" }).waitFor(); }, { session: false });
    await capture(width, "balance-link-invalid", "/manage/balance/not-a-real-balance-link", async page => { await page.getByRole("heading").first().waitFor(); }, { session: false });
  }
  await pay((await json(await owner.request.post(`${origin}/api/public/payments${balance.replace("/manage", "")}`, { headers, data: {} }))).checkoutUrl);
  for (const width of widths) await capture(width, "balance-paid", balance, async page => { await page.getByRole("heading", { name: "Balance paid." }).waitFor(); }, { session: false });

  const record = "/app/bookings?query=Avery%20Deposit";
  const payments = async page => { await page.getByRole("heading", { name: "Avery Deposit", exact: true }).waitFor(); const section = page.getByRole("region", { name: "Payments" }); await section.getByText("Balance paid", { exact: false }).first().waitFor(); return section; };
  for (const width of widths) {
    await capture(width, "booking-record-refund-form", record, async page => { const section = await payments(page); await section.getByRole("button", { name: "Refund" }).click(); await section.getByRole("form", { name: "Refund" }).waitFor(); await section.scrollIntoViewIfNeeded(); });
    await capture(width, "booking-record-refund-refused", record, async page => {
      const section = await payments(page); await section.getByRole("button", { name: "Refund" }).click();
      const form = section.getByRole("form", { name: "Refund" }); await form.getByLabel(/^Amount/u).fill("500.00"); await form.getByLabel("Reason").fill("Too much on purpose"); await form.getByRole("button", { name: "Send refund" }).click();
      await section.getByRole("alert").waitFor(); await section.scrollIntoViewIfNeeded();
    });
  }
  const booking = (await json(await owner.request.get(`${origin}/api/app/bookings?query=Avery%20Deposit`)))[0];
  await json(await owner.request.post(`${origin}/api/app/bookings/${booking.id}/refunds`, { headers, data: { amountCents: 1000, reason: "Started ten minutes late", idempotencyKey: randomUUID() } }));
  for (const width of widths) {
    await capture(width, "booking-record-refunded", record, async page => { const section = await payments(page); await section.getByText("Started ten minutes late").waitFor(); await section.scrollIntoViewIfNeeded(); });
    await capture(width, "receipt-refunded", `/book/dial-host/coaching/confirmed?token=${token}`, async page => { await page.getByText("Refunded: $10.00 USD").waitFor(); }, { session: false });
  }
  console.log(`PAY-003 browser proof: ${shots.length} screenshots (${shots.join(", ")}).`);
} finally { await owner.close(); await browser.close(); }
