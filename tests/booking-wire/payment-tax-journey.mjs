import { paymentFetch } from "./payment-request.mjs";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { bookingMail, recipient, textBody } from "./mail-contracts.mjs";

// PAY-005 through the public and operator doors, with Stripe and Stripe Tax synthetic at the HTTP edge
// (tests/booking-wire/stripe-wire.ts: New York 8.875%, Oregon none).
const origin = process.env.DIAL_REVIEW_ORIGIN, webhookSecret = "whsec_wiretest";
const redact = text => text.replace(/\/manage\/[^/?\s"'<>]+/gu, "/manage/[redacted]").replace(/return=[^&\s"']+/gu, "return=[redacted]");
let cookie;
const checks = [];
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST", headers = {}) {
  const response = await paymentFetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie && !headers.anonymous ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }), redirect: "manual" });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${redact(path)} ${response.status}: ${redact(await response.clone().text())}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const signature = payload => { const timestamp = Math.floor(Date.now() / 1000); return `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex")}`; };
const stripeEvent = (type, object) => JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event", type, account: "acct_wirehost", livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
const webhook = payload => call("/api/webhooks/stripe", payload, 200, "POST", { "content-type": "application/json", "stripe-signature": signature(payload), anonymous: "1" });
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const sessionOf = url => new URL(url).pathname.split("/").at(-1);
const checkoutForm = async () => JSON.parse((await state()).wire_calls.filter(row => row.method === "POST" && new URL(row.url).pathname === "/v1/checkout/sessions").at(-1).body);
const receipts = (snap, bookingId) => bookingMail(snap, bookingId).filter(mail => /^Receipt:/.test(mail.subject));
const newYork = { line1: "350 Fifth Avenue", city: "New York", state: "NY", postalCode: "10118", country: "US" };
const oregon = { line1: "1221 SW 4th Avenue", city: "Portland", state: "OR", postalCode: "97204", country: "US" };

const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Payments owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await data("/__fixtures/setup", {});
await data("/wire/control", { name: "google-conference", value: "success" });
await call("/__fixtures/payments/connect", { accountId: "acct_wirehost" }, 204);
const eventInput = (slug, title) => ({ slug, title, description: "A synthetic paid session.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) });

// Settings: Stripe Tax on, with the business name receipts carry.
assert.deepEqual(await data("/api/app/payments/settings"), { taxEnabled: false, businessName: null, effectiveBusinessName: "Morgan Bell" }, "tax starts off and receipts default to the host's name");
assert.deepEqual(await data("/api/app/payments/settings", { taxEnabled: true, businessName: "Morgan Bell Coaching" }, 200, "PUT"), { taxEnabled: true, businessName: "Morgan Bell Coaching", effectiveBusinessName: "Morgan Bell Coaching" });
const session = await data("/api/app/event-types", eventInput("session", "Strategy session"), 201);
await call(`/api/app/event-types/${session.id}/price`, { amountCents: 20000, durationPrices: [] }, 200, "PUT");
await data(`/api/app/event-types/${session.id}/payment-terms`, { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: 24, lateCancelFeeCents: 3000, noShowFeeCents: 0 }, 200, "PUT");
await data(`/api/app/event-types/${session.id}/publish`, {});
const coaching = await data("/api/app/event-types", eventInput("coaching", "Coaching block"), 201);
await call(`/api/app/event-types/${coaching.id}/price`, { amountCents: 10000, durationPrices: [] }, 200, "PUT");
await data(`/api/app/event-types/${coaching.id}/payment-terms`, { deposit: { kind: "percent", percent: 20 }, balanceDueHours: 24, freeWindowHours: null, lateCancelFeeCents: 0, noShowFeeCents: 0 }, 200, "PUT");
await data(`/api/app/event-types/${coaching.id}/publish`, {});

const taken = new Set();
const slot = async (slug, week, after = 0) => { const found = (await data(`/api/public/book/dial-host/${slug}/availability?week=${week}&durationMinutes=60`)).slots.map(entry => entry.startAt).find(startAt => !taken.has(startAt) && Date.parse(startAt) >= Date.now() + after); taken.add(found); return found; };
async function select(slug, startAt) {
  const selection = await data(`/api/public/book/dial-host/${slug}/selection`, { startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
  const shown = (await data(`/api/public/book/dial-host/${slug}/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`)).payment;
  return { nonce: selection.nonce, startAt, shown };
}
const tax = (slug, chosen, billingAddress) => data(`/api/public/book/dial-host/${slug}/tax`, { nonce: chosen.nonce, startAt: chosen.startAt, inviteeTimezone: "UTC", billingAddress });
async function book(slug, chosen, person, billingAddress, shownTaxCents) {
  const payload = { nonce: chosen.nonce, startAt: chosen.startAt, durationMinutes: 60, inviteeTimezone: "UTC", name: person.name, email: person.email, answers: {}, billingAddress, shownTaxCents, ...(chosen.shown.consent ? { cardConsent: { accepted: true, version: chosen.shown.consent.version } } : {}) };
  const step = await data(`/api/public/book/dial-host/${slug}/confirm`, payload, 202);
  const form = await checkoutForm();
  const paid = await data("/__fixtures/payments/pay", { sessionId: sessionOf(step.payment.checkoutUrl) });
  const completed = stripeEvent("checkout.session.completed", paid);
  await webhook(completed); await webhook(completed);
  const returned = await data(`/api/public/payments/${new URL(step.payment.returnUrl).searchParams.get("return")}`);
  assert.equal(returned.state, "confirmed");
  return { step, form, paid, manage: new URL(returned.manageUrl).pathname.split("/").at(-1), booking: (await state()).bookings.find(row => row.invitee_email === person.email) };
}

// A taxable address: Stripe Tax prices New York sales tax before payment, and Checkout charges exactly that.
const chosenNy = await select("session", await slot("session", day(10)));
assert.equal(chosenNy.shown.taxRequired, true, "with Stripe Tax on, the booking step asks for the billing address");
const quoteNy = await tax("session", chosenNy, newYork);
assert.deepEqual([quoteNy.taxCents, quoteNy.dueNowTaxCents, quoteNy.dueNowTotalCents], [1775, 1775, 21775], "8.875% of $200.00 shown before payment");
assert.ok(quoteNy.summary.includes("NY"), "the jurisdiction is named");
const missing = await (await call("/api/public/book/dial-host/session/confirm", { nonce: chosenNy.nonce, startAt: chosenNy.startAt, durationMinutes: 60, inviteeTimezone: "UTC", name: "Nora York", email: "nora@dial.test", answers: {}, cardConsent: { accepted: true, version: chosenNy.shown.consent.version } }, 400)).json();
assert.equal(missing.error.code, "billing_address_required");
const changed = await (await call("/api/public/book/dial-host/session/confirm", { nonce: chosenNy.nonce, startAt: chosenNy.startAt, durationMinutes: 60, inviteeTimezone: "UTC", name: "Nora York", email: "nora@dial.test", answers: {}, billingAddress: newYork, shownTaxCents: 0, cardConsent: { accepted: true, version: chosenNy.shown.consent.version } }, 409)).json();
assert.deepEqual([changed.error.code, changed.error.details], ["tax_changed", ["1775"]], "Dial never charges tax it did not show");
assert.equal((await state()).payment_holds.length, 0, "nothing is held without the shown tax");
const ny = await book("session", chosenNy, { name: "Nora York", email: "nora@dial.test" }, newYork, quoteNy.dueNowTaxCents);
assert.deepEqual([ny.form["line_items[0][price_data][unit_amount]"], ny.form["line_items[1][price_data][unit_amount]"], ny.paid.amount_total], ["20000", "1775", 21775], "Checkout charges the price and the shown tax");
let snap = await state();
assert.deepEqual(snap.booking_payments.filter(row => row.booking_id === ny.booking.id).map(row => [row.amount_cents, row.tax_cents, row.tax_summary]), [[21775, 1775, quoteNy.summary]]);
assert.equal(JSON.stringify(await data("/__fixtures/payments/all-rows")).includes("350 Fifth Avenue"), false, "Dial stores the tax figures, never the address");
checks.push("with Stripe Tax on, a New York address shows $17.75 tax on $200.00 before payment; confirming without the address or with another tax figure holds nothing; Checkout charges $217.75 with the tax as its own line; Dial stores tax amount and jurisdiction, not the address");

// A non-taxable address shows and charges none.
const chosenOr = await select("session", await slot("session", day(11)));
const quoteOr = await tax("session", chosenOr, oregon);
assert.deepEqual([quoteOr.taxCents, quoteOr.dueNowTotalCents, quoteOr.summary], [0, 20000, null]);
const or = await book("session", chosenOr, { name: "Owen Gon", email: "owen@dial.test" }, oregon, 0);
assert.deepEqual([or.form["line_items[0][price_data][unit_amount]"], or.form["line_items[1][price_data][unit_amount]"], or.paid.amount_total], ["20000", undefined, 20000]);
checks.push("an Oregon address shows no tax, and Checkout charges $200.00 with no tax line");

// Receipts: one per payment, with business name, amount, tax and Stripe reference, to the invitee and host recipients only.
await deliver();
snap = await state();
const receiptNy = receipts(snap, ny.booking.id), receiptOr = receipts(snap, or.booking.id);
assert.deepEqual(receiptNy.flatMap(recipient).sort(), ["nora@dial.test", "operator@dial.test"], "a repeated signed event sends no second receipt; only the invitee and the host receive it (NOTIFY-008)");
for (const mail of receiptNy) assert.ok(["Morgan Bell Coaching", "$217.75 USD", "$17.75 USD", ny.paid.id].every(part => textBody(mail).includes(part)), "the receipt carries business name, amount, tax and the Stripe reference");
assert.ok(receiptOr.every(mail => textBody(mail).includes("$200.00 USD") && textBody(mail).includes("Sales tax: none")));
const pageNy = (await data(`/api/public/manage/${ny.manage}`)).payment;
assert.deepEqual([pageNy.businessName, pageNy.taxCents, pageNy.payments.map(entry => [entry.amountCents, entry.taxCents, entry.reference])], ["Morgan Bell Coaching", 1775, [[21775, 1775, ny.paid.id]]], "the receipt page shows the same figures");
const recordNy = await data(`/api/app/bookings/${ny.booking.id}`);
assert.deepEqual([recordNy.money.payment.amountCents, recordNy.money.payment.taxCents, recordNy.money.payment.checkoutSessionId], [21775, 1775, ny.paid.id], "so does the operator record");
checks.push("each payment sends exactly one receipt to the invitee and the host only, even with the signed event repeated, carrying the business name, amount, tax and Stripe reference; the receipt page and operator record show the same figures");

// A deposit with tax: the deposit carries its share, the balance link charges the rest, and the balance gets its own receipt.
const chosenDeposit = await select("coaching", await slot("coaching", day(12)));
const quoteDeposit = await tax("coaching", chosenDeposit, newYork);
assert.deepEqual([quoteDeposit.taxCents, quoteDeposit.dueNowCents, quoteDeposit.dueNowTaxCents, quoteDeposit.dueNowTotalCents, quoteDeposit.balanceTotalCents], [888, 2000, 178, 2178, 8710], "20% deposit of $100.00 with its share of $8.88 tax; the balance carries the rest");
const deposit = await book("coaching", chosenDeposit, { name: "Dana Deposit", email: "dana@dial.test" }, newYork, quoteDeposit.dueNowTaxCents);
const balanceUrl = (await data(`/api/public/manage/${deposit.manage}`)).payment.balanceUrl;
const balanceToken = new URL(balanceUrl).pathname.split("/").at(-1);
assert.deepEqual(await data(`/api/public/payments/balance/${balanceToken}`).then(status => [status.balanceDueCents, status.taxCents]), [8710, 710]);
const balance = await data(`/api/public/payments/balance/${balanceToken}`, {});
const balanceForm = await checkoutForm();
assert.deepEqual([balanceForm["line_items[0][price_data][unit_amount]"], balanceForm["line_items[1][price_data][unit_amount]"]], ["8000", "710"]);
const balanceEvent = stripeEvent("checkout.session.completed", await data("/__fixtures/payments/pay", { sessionId: sessionOf(balance.checkoutUrl) }));
await webhook(balanceEvent); await webhook(balanceEvent);
await deliver();
const depositReceipts = receipts(await state(), deposit.booking.id);
assert.deepEqual(depositReceipts.map(mail => mail.subject).sort(), ["Receipt: $21.78 USD paid to Morgan Bell Coaching", "Receipt: $21.78 USD paid to Morgan Bell Coaching", "Receipt: $87.10 USD paid to Morgan Bell Coaching", "Receipt: $87.10 USD paid to Morgan Bell Coaching"], "the deposit and the balance each send one receipt per recipient");
checks.push("a 20% deposit charges $20.00 plus $1.78 of the $8.88 tax, the balance link charges $80.00 plus $7.10, and each payment sends one receipt to each recipient");

// A late-cancellation fee charged to the saved card also gets one receipt; the fee is exactly as stated, with no tax added.
const chosenLate = await select("session", await slot("session", day(0), 3600000));
const late = await book("session", chosenLate, { name: "Lee Late", email: "lee@dial.test" }, newYork, (await tax("session", chosenLate, newYork)).dueNowTaxCents);
await call(`/api/public/manage/${late.manage}/cancel`, {});
await deliver();
snap = await state();
const fee = snap.payment_movements.find(row => row.booking_id === late.booking.id && row.kind === "late_cancel_fee");
assert.deepEqual([fee.status, fee.amount_cents, fee.tax_cents], ["succeeded", 3000, 0]);
assert.ok(receipts(snap, late.booking.id).some(mail => textBody(mail).includes("Late-cancellation fee: $30.00 USD paid") && textBody(mail).includes(fee.processor_ref)), "the fee's receipt names it and its Stripe reference");
checks.push("a late-cancellation fee charged off-session sends its own receipt; the fee is the stated $30.00 with no tax added");

// An invoice for an unpaid booking: Stripe hosts it; its amounts match the receipt; only the signed invoice.paid marks it paid.
const operatorSlot = await slot("session", day(14));
const operatorBooking = await data("/api/app/bookings", { eventTypeId: session.id, startAt: operatorSlot, inviteeTimezone: "UTC", name: "Ivy Invoice", email: "ivy@dial.test", answers: {} }, 201);
assert.equal((await (await call(`/api/app/bookings/${operatorBooking.id}/invoice`, {}, 400)).json()).error.code, "billing_address_required");
const issued = await data(`/api/app/bookings/${operatorBooking.id}/invoice`, { billingAddress: newYork });
const again = await data(`/api/app/bookings/${operatorBooking.id}/invoice`, { billingAddress: newYork });
assert.deepEqual([issued.invoice.amountCents, issued.invoice.taxCents, issued.invoice.status], [21775, 1775, "pending"], "the invoice carries the duration's price and its tax, unpaid");
assert.deepEqual(again.invoice, issued.invoice, "issuing again returns the same invoice");
snap = await state();
assert.equal(snap.wire_calls.filter(row => row.method === "POST" && new URL(row.url).pathname === "/v1/invoices").length, 1, "one Stripe invoice");
const stripeInvoice = JSON.parse(snap.wire_stripe_objects.find(row => row.id === issued.invoice.id).payload);
assert.deepEqual([stripeInvoice.total, stripeInvoice.lines.map(line => line.amount), stripeInvoice.hosted_invoice_url], [21775, [20000, 1775], issued.invoice.url]);
await deliver();
assert.ok(bookingMail(await state(), operatorBooking.id).some(mail => /^Invoice from Morgan Bell Coaching/.test(mail.subject) && recipient(mail).includes("ivy@dial.test") && textBody(mail).includes(issued.invoice.url)), "the invitee receives the invoice with Stripe's payment link");
const paidInvoice = await data("/__fixtures/payments/pay-invoice", { invoiceId: issued.invoice.id });
assert.equal((await data(`/api/app/bookings/${operatorBooking.id}`)).money.movements.find(row => row.kind === "invoice").status, "pending", "paying on Stripe's page alone marks nothing paid");
const invoicePaid = stripeEvent("invoice.paid", paidInvoice);
await webhook(invoicePaid); await webhook(invoicePaid);
await deliver();
snap = await state();
const invoiceReceipts = receipts(snap, operatorBooking.id);
assert.deepEqual(invoiceReceipts.flatMap(recipient).sort(), ["ivy@dial.test", "operator@dial.test"]);
for (const mail of invoiceReceipts) assert.ok(textBody(mail).includes("Invoice payment: $217.75 USD paid") && textBody(mail).includes("$17.75 USD"), "the receipt carries the invoice's amount and tax");
assert.deepEqual((await data(`/api/app/bookings/${operatorBooking.id}`)).money.movements.map(row => [row.kind, row.status, row.amountCents, row.taxCents]), [["invoice", "succeeded", 21775, 1775]]);
checks.push("an operator-created booking is invoiced for $200.00 plus $17.75 New York tax on a Stripe-hosted invoice emailed to the invitee; issuing again returns the same invoice; only the signed invoice.paid marks it paid, once, and its receipt carries the same amounts");

// PAY-003/PAY-005: cumulative refund tax must conserve the original $17.75 collected on $217.75.
// These amounts and the pro-rata oracle come from that payment, independently of Dial's allocation code.
// Rounding three thirds separately over-refunds tax; rounding three $50 parts separately drifts before a full refund.
const chosenPartial = await select("session", await slot("session", day(15)));
const partial = await book("session", chosenPartial, { name: "synthetic-dial-1", email: "synthetic-dial-1@example.test" }, newYork, (await tax("session", chosenPartial, newYork)).dueNowTaxCents);
await deliver();
const refundCases = [
  { name: "three partial refunds completing a full refund", paid: ny, amounts: [7258, 7258, 7259], cumulative: [7258, 14516, 21775] },
  { name: "three partial refunds leaving money paid", paid: partial, amounts: [5000, 5000, 5000], cumulative: [5000, 10000, 15000] },
];
// Hand count of the payments above, including the second New York booking; only Lee's fee adds $30.
const revenueCents = 21775 + 20000 + 2178 + 8710 + 21775 + 21775 + 21775;
const refundTaxFailures = [];
let previousRefundsCents = 0;
for (const scenario of refundCases) {
  const checkpoints = [];
  for (const [index, amountCents] of scenario.amounts.entries()) {
    await data(`/api/app/bookings/${scenario.paid.booking.id}/refunds`, { amountCents, reason: "Ended early", idempotencyKey: randomUUID() });
    const record = await data(`/api/app/bookings/${scenario.paid.booking.id}`);
    const receipt = (await data(`/api/public/manage/${scenario.paid.manage}`)).payment;
    const report = (await data(`/api/app/reports/scheduling?${new URLSearchParams({ fromDate: day(-1), throughDate: day(1) })}`)).tiles.find(tile => tile.key === "revenue");
    const money = Object.fromEntries(report.figures.map(figure => [figure.key, figure.value]));
    const refundedCents = scenario.cumulative[index], netCents = 21775 - refundedCents;
    const refunds = record.money.movements.filter(row => row.kind === "refund");
    assert.deepEqual(refunds.map(row => [row.status, row.amountCents]), scenario.amounts.slice(0, index + 1).map(amount => ["succeeded", amount]));
    assert.deepEqual([record.money.ledger.paidCents, record.money.ledger.refundedCents, record.money.ledger.netCents], [21775, refundedCents, netCents]);
    assert.deepEqual([receipt.paidCents, receipt.refundedCents, receipt.netCents, receipt.taxCents], [21775, refundedCents, netCents, record.money.ledger.taxCents], "the public booking receipt agrees with the operator's refund and net tax");
    assert.deepEqual(receipt.payments.map(row => [row.amountCents, row.taxCents]), [[21775, 1775]], "the receipt retains the original payment and collected tax");
    assert.deepEqual(receipt.movements.filter(row => row.kind === "refund").map(row => [row.amountCents, row.status, row.reference]), refunds.map(row => [row.amountCents, row.status, row.processorRef]), "refund amounts and processor references agree on the receipt");
    assert.deepEqual(money, { revenue: revenueCents, fees: 3000, refunds: previousRefundsCents + refundedCents, net: revenueCents + 3000 - previousRefundsCents - refundedCents }, "the report agrees after every partial refund");
    checkpoints.push({ refundedCents, taxCents: refunds.reduce((total, row) => total + row.taxCents, 0), netTaxCents: record.money.ledger.taxCents });
  }
  // Run both sequences before reporting a tax failure, so the baseline exposes both rounding defects.
  try {
    for (const checkpoint of checkpoints) {
      const label = `${scenario.name} after refunding ${checkpoint.refundedCents} cents`;
      assert.ok(checkpoint.taxCents >= 0 && checkpoint.taxCents <= 1775, `${label}: cumulative tax refunded (${checkpoint.taxCents}) never exceeds the 1775 cents collected`);
      assert.ok(Math.abs(checkpoint.taxCents * 21775 - checkpoint.refundedCents * 1775) <= 21775, `${label}: cumulative tax (${checkpoint.taxCents}) stays within one cent of the original payment's pro-rata tax`);
      assert.ok(checkpoint.netTaxCents >= 0, `${label}: the ledger never reports negative net tax`);
      assert.equal(checkpoint.netTaxCents, 1775 - checkpoint.taxCents, `${label}: net tax conserves the collected tax`);
      if (checkpoint.refundedCents === 21775) assert.deepEqual([checkpoint.taxCents, checkpoint.netTaxCents], [1775, 0], "a full refund returns exactly all collected tax");
    }
  } catch (error) { refundTaxFailures.push(`${scenario.name}: ${error.message}`); }
  previousRefundsCents += scenario.cumulative.at(-1);
}
assert.deepEqual(refundTaxFailures, [], "cumulative tax is conserved for both refund sequences");
checks.push("three partial refunds of $72.58, $72.58 and $72.59 return exactly the $17.75 tax on a $217.75 payment; three $50.00 partial refunds keep cumulative tax within one cent of pro-rata before a full refund; net tax remains nonnegative, and the record, public receipt and report agree after each refund");

await writeFile(evidencePath("payment-tax-wire.json"), JSON.stringify({ title: "PAY-005 Stripe Tax, receipts and invoices carry matching amounts", checks, scope: "Native local D1 and production services with Stripe, Stripe Tax and signed webhooks synthetic at the HTTP edge" }, null, 2));
console.log("PAY-005 sales tax, receipts and invoices journey passed.");
