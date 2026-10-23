import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { screenRecorder, screenshotFolder, widths } from "./screens-support.mjs";

// PAY-003 and PAY-005 browser proof on the review rig, with Stripe and Stripe Tax synthetic at the HTTP edge: the event
// type's deposit and cancellation policy, the pay step with its consent (and the refusal without it), the manage page's
// balance, the balance link due, paid and invalid, the booking record's payments with the refund form and a refused
// refund, the receipt after a refund; then Stripe Tax settings, the pay step's billing address with taxable and
// non-taxable tax, the receipt with tax and the booking record's invoice, at 1440 and 390 pixels with axe.
// Run with DIAL_MONEY_SCREENS set to the evidence folder.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752", folder = await screenshotFolder("DIAL_MONEY_SCREENS"), headers = { Origin: origin };
const webhookSecret = "whsec_wiretest";
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext();
const json = async (response, expected = 200) => { assert.equal(response.status(), expected, await response.text()); return response.json(); };
const webhook = async (object, type = "checkout.session.completed") => {
  const body = JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event", type, account: "acct_wirehost", livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
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

  // A fee edit while the details page is open refuses the old consent, refreshes the terms and unchecks consent.
  const staleConsentErrors = [];
  const originalTerms = { deposit: { kind: "fixed", amountCents: 2500 }, balanceDueHours: 24, freeWindowHours: 48, lateCancelFeeCents: 4000, noShowFeeCents: 6000 };
  for (const width of widths) {
    const consentWeek = new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10);
    const consentSlot = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/availability?week=${consentWeek}&durationMinutes=60`))).slots[0].startAt;
    const consentSelection = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/selection`, { headers, data: { startAt: consentSlot, inviteeTimezone: "UTC", durationMinutes: 60 } }), 201);
    const consentDetails = `/book/dial-host/coaching/details?${new URLSearchParams({ nonce: consentSelection.nonce, startAt: consentSlot, inviteeTimezone: "UTC", durationMinutes: "60" })}`;
    try {
      await capture(width, "stale-consent-new-terms", consentDetails, async page => {
        await page.getByLabel("Name", { exact: true }).fill(`synthetic-dial-${width}`);
        await page.getByLabel("Email", { exact: true }).fill(`synthetic-dial-${width}@example.test`);
        await page.getByRole("checkbox", { name: /I agree that Stripe saves my card/u }).check();
        await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: { ...originalTerms, lateCancelFeeCents: 9000 } }));
        const refused = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/confirm") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Continue to payment · $25.00 USD" }).click();
        assert.equal((await refused).status(), 400);
        const newConsent = page.getByRole("checkbox", { name: /90\.00/u });
        try { await newConsent.waitFor({ timeout: 5000 }); }
        catch (error) { await page.screenshot({ path: `${folder}/stale-consent-before-${width}.png`, fullPage: true }); throw error; }
        assert.equal(await newConsent.isChecked(), false, "new terms require a fresh unchecked consent");
        assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), `synthetic-dial-${width}`, "a refused fee edit keeps the invitee details");
      }, { session: false });
    } catch (error) { staleConsentErrors.push({ width, message: error.message.split("\n")[0] }); }
    finally { await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: originalTerms })); }
  }
  assert.deepEqual(staleConsentErrors, [], "stale consent refreshes the shown terms at both widths");

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
  const qboStart=await owner.request.get(origin+'/api/app/payments/accounting/oauth/start',{maxRedirects:0});
  assert.equal((await owner.request.get(`${origin}/api/payments/accounting/oauth/callback?${new URLSearchParams({state:new URL(qboStart.headers().location).searchParams.get('state'),code:'synthetic-dial-304',realmId:'synthetic-dial-303'})}`,{maxRedirects:0})).status(),302);
  const income=(await json(await owner.request.get(origin+'/api/app/payments/accounting/accounts'))).accounts[0];
  await json(await owner.request.put(origin+'/api/app/payments/accounting/mapping',{headers,data:{accountId:income.id}}));
  for(const width of widths)await capture(width,'payments-income-mapping','/app/settings',async page=>{await page.locator('[data-operator-ready="true"]').waitFor();const section=page.locator('#payment-reconciliation');await section.getByRole('button',{name:'Choose income account',exact:true}).click();const form=section.getByRole('form',{name:'Accounting income account'});await form.getByLabel('Income account',{exact:true}).selectOption(income.id);await form.scrollIntoViewIfNeeded();return section;});
  await json(await owner.request.post(origin+'/api/app/payments/accounting/export',{headers,data:{}}));
  for(const width of widths)await capture(width,'payments-exported','/app/settings',async page=>{await page.locator('[data-operator-ready="true"]').waitFor();const section=page.locator('#payment-reconciliation');await section.getByText('Exported',{exact:true}).first().waitFor();await section.scrollIntoViewIfNeeded();return section;});
  for(const width of widths)await capture(width,'payments-open-booking','/app/settings',async page=>{await page.locator('[data-operator-ready="true"]').waitFor();await page.locator('#payment-reconciliation').getByRole('link',{name:/Avery Deposit/u}).first().click();await page.getByRole('heading',{name:'Avery Deposit',exact:true}).waitFor();});
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
  // PAY-005: Stripe Tax on, with the business name receipts carry.
  await json(await owner.request.put(`${origin}/api/app/payments/settings`, { headers, data: { taxEnabled: true, businessName: "Morgan Bell Coaching" } }));
  for (const width of widths) await capture(width, "settings-tax", "/app/settings", async page => { const form = page.getByRole("form", { name: "Sales tax and receipts" }); await form.getByRole("checkbox", { name: /Stripe Tax/u }).waitFor(); for (let attempt = 0; await form.getByLabel("Business name on receipts and invoices").inputValue() !== "Morgan Bell Coaching"; attempt++) { assert.ok(attempt < 100, "saved business name loads"); await page.waitForTimeout(100); } await form.scrollIntoViewIfNeeded(); return form; });
  const taxWeek = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
  const taxSlot = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/availability?week=${taxWeek}&durationMinutes=60`))).slots[0].startAt;
  const taxSelection = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/selection`, { headers, data: { startAt: taxSlot, inviteeTimezone: "America/New_York", durationMinutes: 60 } }), 201);
  const taxDetails = `/book/dial-host/coaching/details?${new URLSearchParams({ nonce: taxSelection.nonce, startAt: taxSlot, inviteeTimezone: "America/New_York", durationMinutes: "60" })}`;
  const address = async (page, street, city, state, zip) => { await page.getByLabel("Street address").fill(street); await page.getByLabel("City").fill(city); await page.getByLabel("State").fill(state); await page.getByLabel("ZIP code").fill(zip); };
  for (const width of widths) {
    await capture(width, "pay-step-tax", taxDetails, async page => { await address(page, "350 Fifth Avenue", "New York", "NY", "10118"); await page.getByText("Sales tax: $2.22 USD", { exact: false }).waitFor(); await page.getByRole("button", { name: "Continue to payment · $27.22 USD" }).waitFor(); }, { session: false });
    await capture(width, "pay-step-no-tax", taxDetails, async page => { await address(page, "1221 SW 4th Avenue", "Portland", "OR", "97204"); await page.getByText("No sales tax applies to this address.", { exact: false }).waitFor(); }, { session: false });
  }
  const taxShown = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/selection?${new URLSearchParams({ nonce: taxSelection.nonce, startAt: taxSlot, inviteeTimezone: "America/New_York" })}`))).payment;
  const newYork = { line1: "350 Fifth Avenue", city: "New York", state: "NY", postalCode: "10118", country: "US" };
  const taxQuote = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/tax`, { headers, data: { nonce: taxSelection.nonce, startAt: taxSlot, inviteeTimezone: "America/New_York", billingAddress: newYork } }));
  const taxStep = await json(await owner.request.post(`${origin}/api/public/book/dial-host/coaching/confirm`, { headers, data: { nonce: taxSelection.nonce, startAt: taxSlot, durationMinutes: 60, inviteeTimezone: "America/New_York", name: "Tara Tax", email: "tara.tax@example.test", answers: {}, cardConsent: { accepted: true, version: taxShown.consent.version }, billingAddress: newYork, shownTaxCents: taxQuote.dueNowTaxCents } }), 202);
  await pay(taxStep.payment.checkoutUrl);
  const taxStatus = await json(await owner.request.get(`${origin}/api/public/payments/${new URL(taxStep.payment.returnUrl).searchParams.get("return")}`));
  const taxToken = new URL(taxStatus.manageUrl).pathname.split("/").at(-1);
  for (const width of widths) await capture(width, "receipt-tax", `/book/dial-host/coaching/confirmed?token=${taxToken}`, async page => { await page.getByText("Sales tax included: $2.22 USD", { exact: false }).waitFor(); await page.getByText("Paid to Morgan Bell Coaching").waitFor(); }, { session: false });
  const invoiceWeek = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const invoiceSlot = (await json(await owner.request.get(`${origin}/api/public/book/dial-host/coaching/availability?week=${invoiceWeek}&durationMinutes=60`))).slots[0].startAt;
  const invoiced = await json(await owner.request.post(`${origin}/api/app/bookings`, { headers, data: { eventTypeId: event.id, startAt: invoiceSlot, inviteeTimezone: "America/New_York", name: "Ivy Invoice", email: "ivy.invoice@example.test", answers: {} } }), 201);
  const invoiceRecord = "/app/bookings?query=Ivy%20Invoice";
  const invoiceSection = async page => { await page.getByRole("heading", { name: "Ivy Invoice", exact: true }).waitFor(); const section = page.getByRole("region", { name: "Payments" }); await section.waitFor(); return section; };
  for (const width of widths) await capture(width, "booking-record-invoice-form", invoiceRecord, async page => { const section = await invoiceSection(page); await section.getByRole("button", { name: "Issue invoice" }).click(); await section.getByRole("form", { name: "Issue invoice" }).getByLabel("ZIP code").waitFor(); await section.scrollIntoViewIfNeeded(); });
  await json(await owner.request.post(`${origin}/api/app/bookings/${invoiced.id}/invoice`, { headers, data: { billingAddress: newYork } }));
  for (const width of widths) await capture(width, "booking-record-invoiced", invoiceRecord, async page => { const section = await invoiceSection(page); await section.getByRole("link", { name: "Stripe-hosted invoice" }).waitFor(); await section.scrollIntoViewIfNeeded(); });
  const invoiceMoney = (await json(await owner.request.get(`${origin}/api/app/bookings/${invoiced.id}/money`))).money;
  const invoiceId = invoiceMoney.movements.find(movement => movement.kind === "invoice").invoiceId;
  await webhook(await json(await owner.request.post(origin + "/__fixtures/payments/pay-invoice", { headers, data: { invoiceId } })), "invoice.paid");
  for (const width of widths) {
    await capture(width, "paid-invoice-cancel-refund-choice", invoiceRecord, async page => {
      await invoiceSection(page);
      // The invoice is paid through the general ledger and has no booking_payments row.
      await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
      const form = page.getByRole("form", { name: "Cancel booking" });
      await form.waitFor({ timeout: 5000 });
      await form.getByText("Refund everything paid, $108.88 USD.", { exact: false }).waitFor();
      await form.getByRole("radio", { name: "Refund less, or nothing, with a reason" }).check();
      await form.getByLabel("Amount to refund (USD)").fill("0.00");
      await form.getByRole("button", { name: "Cancel booking" }).click();
      await form.getByRole("alert").getByText("Give the reason for refunding less.", { exact: false }).waitFor();
      await form.getByLabel("Amount to refund (USD)").fill("40.00");
      await form.getByLabel("Reason for the smaller refund").fill("Preparation was delivered");
      await form.scrollIntoViewIfNeeded(); return form;
    });
  }
  await json(await owner.request.post(`${origin}/api/app/bookings/${invoiced.id}/cancel`, { headers, data: { refund: { amountCents: 4000, reason: "Preparation was delivered" } } }));
  await json(await owner.request.post(origin + "/__fixtures/deliver", { headers, data: {} }));
  const invoiceCancellation = (await json(await owner.request.get(origin + "/__fixtures/status"))).fixture_mail.map(row => JSON.parse(row.message_json)).filter(message => message.to === "ivy.invoice@example.test" && /^Booking cancelled:/u.test(message.subject ?? ""));
  assert.equal(invoiceCancellation.length, 1);
  assert.ok(invoiceCancellation[0].text.includes("$40.00 USD") && invoiceCancellation[0].text.includes("Preparation was delivered"));
  // PAY-006 adds reconciliation and accounting to the existing payments screen/browser.
  const native=await json(await owner.request.get(`${origin}/api/app/bookings/${booking.id}`));
  const reconciliationIntent=native.payment.paymentIntentId;
  await webhook({id:'synthetic-dial-301',payment_intent:reconciliationIntent,currency:'usd',amount:2500,status:'needs_response'},'charge.dispute.created');
  const accountingSection=async page=>{await page.locator('[data-operator-ready="true"]').waitFor();const section=page.locator('#payment-reconciliation');await section.getByText('Needs attention',{exact:true}).waitFor();await section.scrollIntoViewIfNeeded();return section;};
  for(const width of widths){
    await capture(width,'payments-flagged','/app/settings',accountingSection);
    await capture(width,'booking-reconciliation-flagged',record,async page=>{const section=await payments(page);await section.getByRole('list',{name:'Processor reconciliation'}).getByText('Needs attention',{exact:true}).waitFor();await section.scrollIntoViewIfNeeded();return section;});
  }
  // Tax has not been mapped to QuickBooks: refuse explicitly before creating any receipt.
  const qbo=await owner.request.get(origin+'/api/app/payments/accounting/oauth/start',{maxRedirects:0});
  const qboState=new URL(qbo.headers().location).searchParams.get('state');
  assert.equal((await owner.request.get(`${origin}/api/payments/accounting/oauth/callback?${new URLSearchParams({state:qboState,code:'synthetic-dial-302',realmId:'synthetic-dial-303'})}`,{maxRedirects:0})).status(),302);
  const accounts=(await json(await owner.request.get(origin+'/api/app/payments/accounting/accounts'))).accounts;
  await json(await owner.request.put(origin+'/api/app/payments/accounting/mapping',{headers,data:{accountId:accounts[0].id}}));
  await json(await owner.request.post(origin+'/api/app/payments/accounting/export',{headers,data:{}}),409);
  for(const width of widths)await capture(width,'payments-accounting-connected','/app/settings',async page=>{const section=await accountingSection(page);await section.getByRole('button',{name:'Export to QuickBooks Online',exact:true}).click();await section.getByRole('alert').waitFor();return section;});
  // PAY-003 (D4): the host cancels a paid booking from its record; everything paid is refunded unless the operator
  // refunds less with a reason, which the invitee's cancellation email and manage page then state.
  const cancelForm = async page => { await page.getByRole("heading", { name: "Avery Deposit", exact: true }).waitFor(); await page.getByRole("button", { name: "Cancel booking", exact: true }).click(); const form = page.getByRole("form", { name: "Cancel booking" }); await form.getByText("Refund everything paid, $90.00 USD.", { exact: false }).waitFor(); return form; };
  for (const width of widths) {
    await capture(width, "booking-record-cancel-form", record, async page => { const form = await cancelForm(page); await form.scrollIntoViewIfNeeded(); return form; });
    await capture(width, "booking-record-cancel-less-refused", record, async page => {
      const form = await cancelForm(page); await form.getByRole("radio", { name: "Refund less, or nothing, with a reason" }).check();
      await form.getByLabel("Amount to refund (USD)").fill("40.00"); await form.getByRole("button", { name: "Cancel booking" }).click();
      await form.getByRole("alert").getByText("Give the reason for refunding less.", { exact: false }).waitFor(); await form.scrollIntoViewIfNeeded(); return form;
    });
  }
  await json(await owner.request.post(`${origin}/api/app/bookings/${booking.id}/cancel`, { headers, data: { reason: "Host travel", refund: { amountCents: 4000, reason: "Half the session plan was delivered" } } }));
  await json(await owner.request.post(origin + "/__fixtures/deliver", { headers, data: {} }));
  for (const width of widths) {
    await capture(width, "booking-record-host-cancelled", record, async page => { const section = await payments(page); await section.getByText("Half the session plan was delivered").waitFor(); await section.scrollIntoViewIfNeeded(); });
    await capture(width, "manage-host-cancelled", `/manage/${token}`, async page => { await page.getByText("This booking has been cancelled.").waitFor(); await page.getByText("$50.00 USD", { exact: false }).first().waitFor(); }, { session: false });
  }
  // The invitee's cancellation email as delivered, rendered from its own HTML.
  const note = "The host cancelled and refunds $40.00 USD of the $90.00 USD paid. Reason: Half the session plan was delivered. No fee is charged.";
  const delivered = (await json(await owner.request.get(origin + "/__fixtures/status"))).fixture_mail.map(row => JSON.parse(row.message_json)).filter(message => message.to === "avery.deposit@example.test" && /^Booking cancelled:/u.test(message.subject ?? ""));
  assert.equal(delivered.length, 1, "one cancellation email reaches the invitee");
  assert.ok(delivered[0].text.includes(note), "the email states the amount refunded and the reason");
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1024 : 844 } });
    try {
      const page = await context.newPage();
      await page.setContent(delivered[0].html ?? `<pre style="white-space:pre-wrap">${delivered[0].text}</pre>`);
      await page.getByText("Half the session plan was delivered", { exact: false }).first().waitFor();
      const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1);
      assert.ok(overflow, `cancellation email at ${width} has no horizontal overflow`);
      await page.screenshot({ path: `${folder}/invitee-cancellation-email-${width}.png`, fullPage: true });
      shots.push(`invitee-cancellation-email-${width}.png`);
    } finally { await context.close(); }
  }
  console.log(`PAY-003 and PAY-005 browser proof: ${shots.length} screenshots (${shots.join(", ")}).`);
} finally { await owner.close(); await browser.close(); }
