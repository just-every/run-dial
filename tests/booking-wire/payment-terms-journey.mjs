import { paymentFetch } from "./payment-request.mjs";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { bookingMail, textBody } from "./mail-contracts.mjs";
import { reconciliationProbes } from "./reconciliation-probes.mjs";
import { cancellationProbes } from "./payment-cancellation-probes.mjs";
import { paymentErasureProbes } from "./payment-erasure-probes.mjs";

// PAY-003 through the public and operator doors, with Stripe synthetic at the HTTP edge (tests/booking-wire/stripe-wire.ts).
// The webhook signing secret is the synthetic test value in worker.wrangler.toml.
const origin = process.env.DIAL_REVIEW_ORIGIN, webhookSecret = "whsec_wiretest";
const redact = text => text.replace(/\/manage\/[^/?\s"'<>]+/gu, "/manage/[redacted]").replace(/return=[^&\s"']+/gu, "return=[redacted]");
let cookie;
const checks = [];
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST", headers = {}) {
  const raw = typeof body === "string";
  const response = await paymentFetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie && !headers.anonymous ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), redirect: "manual" });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${redact(path)} ${response.status}: ${redact(await response.clone().text())}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const signature = (payload, timestamp = Math.floor(Date.now() / 1000)) => `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex")}`;
const stripeEvent = (type, object, account = "acct_wirehost") => JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, object: "event", type, account, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
const webhook = (payload, expected = 200) => call("/api/webhooks/stripe", payload, expected, "POST", { "content-type": "application/json", "stripe-signature": signature(payload), anonymous: "1" });
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const calls = (snap, path, method = "POST") => snap.wire_calls.filter(row => row.method === method && new URL(row.url).pathname === path);
const sessionOf = url => new URL(url).pathname.split("/").at(-1);

const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Payments owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await data("/__fixtures/setup", {});
await data("/wire/control", { name: "google-conference", value: "success" });
await call("/__fixtures/payments/connect", { accountId: "acct_wirehost" }, 204);
const operatorId = (await data("/api/app/operators")).operators[0].id;
const eventInput = (slug, title) => ({ slug, title, description: "A synthetic paid session.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) });

// Terms: a $25 deposit on a $100 session, the $75 balance due a day before, a 48-hour free window, a $40 late fee and a $60 no-show fee.
const coaching = await data("/api/app/event-types", eventInput("coaching", "Coaching session"), 201);
const terms = { deposit: { kind: "fixed", amountCents: 2500 }, balanceDueHours: 24, freeWindowHours: 48, lateCancelFeeCents: 4000, noShowFeeCents: 6000 };
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/payment-terms`, terms, 400, "PUT")).json()).error.code, "deposit_needs_price", "a deposit needs a price");
await call(`/api/app/event-types/${coaching.id}/price`, { amountCents: 10000, durationPrices: [] }, 200, "PUT");
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/payment-terms`, { ...terms, deposit: { kind: "fixed", amountCents: 10000 } }, 400, "PUT")).json()).error.code, "deposit_too_large");
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/payment-terms`, { ...terms, freeWindowHours: null }, 400, "PUT")).json()).error.code, "late_fee_needs_window");
await call(`/api/app/event-types/${coaching.id}/booking-policy`, { lockedTimezone: null, rescheduleCutoffMinutes: null, cancellationCutoffMinutes: 72 * 60, maxInviteeReschedules: null }, 200, "PUT");
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/payment-terms`, terms, 400, "PUT")).json()).error.code, "window_inside_cutoff", "a free window may not end inside the cancellation cut-off");
await call(`/api/app/event-types/${coaching.id}/booking-policy`, { lockedTimezone: null, rescheduleCutoffMinutes: null, cancellationCutoffMinutes: 24 * 60, maxInviteeReschedules: null }, 200, "PUT");
const saved = await data(`/api/app/event-types/${coaching.id}/payment-terms`, terms, 200, "PUT");
assert.deepEqual({ ...saved, version: undefined }, { ...terms, version: undefined });
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/booking-policy`, { lockedTimezone: null, rescheduleCutoffMinutes: null, cancellationCutoffMinutes: 72 * 60, maxInviteeReschedules: null }, 400, "PUT")).json()).error.code, "window_inside_cutoff", "the cut-off editor refuses a cut-off inside the saved free window");
assert.equal((await (await call(`/api/app/event-types/${coaching.id}/price`, { amountCents: 2000, durationPrices: [] }, 409, "PUT")).json()).error.code, "deposit_conflict", "a price below the saved deposit is refused");
await call(`/api/app/event-types/${coaching.id}/booking-policy`, { lockedTimezone: null, rescheduleCutoffMinutes: null, cancellationCutoffMinutes: null, maxInviteeReschedules: null }, 200, "PUT");
await data(`/api/app/event-types/${coaching.id}/publish`, {});
// A free consultation that only saves a card for a $30 no-show fee: nothing is charged at booking.
const consult = await data("/api/app/event-types", eventInput("consult", "Free consultation"), 201);
await data(`/api/app/event-types/${consult.id}/payment-terms`, { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: null, lateCancelFeeCents: 0, noShowFeeCents: 3000 }, 200, "PUT");
await data(`/api/app/event-types/${consult.id}/publish`, {});
checks.push("terms refuse a deposit without a price, a deposit at the price, a late fee without a window and a window inside the cancellation cut-off; the cut-off editor and a lower price are refused against saved terms");

const slots = async (slug, week) => (await data(`/api/public/book/dial-host/${slug}/availability?week=${week}&durationMinutes=60`)).slots.map(slot => slot.startAt);
const taken = new Set();
const slot = async (slug, week, after = 0) => { const found = (await slots(slug, week)).find(startAt => !taken.has(startAt) && Date.parse(startAt) >= Date.now() + after); taken.add(found); return found; };
async function hold(slug, startAt, email, name, consent) {
  const selection = await data(`/api/public/book/dial-host/${slug}/selection`, { startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
  const shown = (await data(`/api/public/book/dial-host/${slug}/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`)).payment;
  const payload = { nonce: selection.nonce, startAt, durationMinutes: 60, inviteeTimezone: "UTC", name, email, answers: {}, ...(consent ? { cardConsent: { accepted: true, version: shown.consent.version } } : {}) };
  const step = await data(`/api/public/book/dial-host/${slug}/confirm`, payload, 202);
  return { shown, payload, step, returnToken: new URL(step.payment.returnUrl).searchParams.get("return"), sessionId: sessionOf(step.payment.checkoutUrl) };
}
async function complete(held) {
  const paid = await data("/__fixtures/payments/pay", { sessionId: held.sessionId });
  await webhook(stripeEvent("checkout.session.completed", paid));
  const returned = await data(`/api/public/payments/${held.returnToken}`);
  assert.equal(returned.state, "confirmed");
  const manage = new URL(returned.manageUrl).pathname.split("/").at(-1);
  const booking = (await state()).bookings.find(row => row.invitee_email === held.payload.email);
  return { paid, manage, booking };
}

// A deposit booking ten days out: the step shows the deposit, the balance and its due time, the policy and an unchecked consent.
const startA = await slot("coaching", day(10));
const selectionA = await data("/api/public/book/dial-host/coaching/selection", { startAt: startA, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
const shownA = (await data(`/api/public/book/dial-host/coaching/selection?${new URLSearchParams({ nonce: selectionA.nonce, startAt: startA, inviteeTimezone: "UTC" })}`)).payment;
assert.deepEqual([shownA.amountCents, shownA.priceCents, shownA.depositCents, shownA.balanceCents, shownA.mode], [2500, 10000, 2500, 7500, "payment"]);
assert.equal(shownA.balanceDueAt, new Date(Date.parse(startA) - 24 * 3600000).toISOString());
assert.equal(shownA.freeWindowEndsAt, new Date(Date.parse(startA) - 48 * 3600000).toISOString());
assert.ok(shownA.policy.length >= 3 && shownA.consent.version, "the policy and the consent are stated before booking");
assert.deepEqual([shownA.consent.lateCancelFeeCents, shownA.consent.noShowFeeCents], [4000, 6000]);
const refusedA = await (await call("/api/public/book/dial-host/coaching/confirm", { nonce: selectionA.nonce, startAt: startA, durationMinutes: 60, inviteeTimezone: "UTC", name: "synthetic-dial-person+Avery Deposit", email: "synthetic-dial-person+avery@example.test", answers: {} }, 400)).json();
assert.equal(refusedA.error.code, "card_consent_required");
assert.equal((await state()).payment_holds.length, 0, "nothing is held without the consent");
const stepA = await data("/api/public/book/dial-host/coaching/confirm", { nonce: selectionA.nonce, startAt: startA, durationMinutes: 60, inviteeTimezone: "UTC", name: "synthetic-dial-person+Avery Deposit", email: "synthetic-dial-person+avery@example.test", answers: {}, cardConsent: { accepted: true, version: shownA.consent.version } }, 202);
assert.equal(stepA.payment.amountCents, 2500);
let snap = await state();
const formA = JSON.parse(calls(snap, "/v1/checkout/sessions").at(-1).body);
assert.deepEqual([formA["line_items[0][price_data][unit_amount]"], formA["payment_intent_data[setup_future_usage]"], formA.customer_creation, formA["excluded_payment_method_types[0]"]], ["2500", "off_session", "always", "us_bank_account"], "Checkout charges the $25 deposit and keeps the consented card");
const heldA = { payload: { email: "synthetic-dial-person+avery@example.test" }, returnToken: new URL(stepA.payment.returnUrl).searchParams.get("return"), sessionId: sessionOf(stepA.payment.checkoutUrl) };
const { manage: manageA, booking: bookingA } = await complete(heldA);
snap = await state();
assert.deepEqual(snap.booking_payments.filter(row => row.booking_id === bookingA.id).map(row => [row.kind, row.amount_cents]), [["deposit", 2500]]);
assert.deepEqual(snap.booking_payment_terms.filter(row => row.booking_id === bookingA.id).map(row => [row.price_cents, row.deposit_cents, row.balance_cents, row.free_window_hours, row.late_cancel_fee_cents, row.no_show_fee_cents]), [[10000, 2500, 7500, 48, 4000, 6000]]);
const consentA = snap.booking_card_consents.find(row => row.booking_id === bookingA.id);
assert.deepEqual([consentA.consent_text_version, consentA.late_cancel_fee_cents, consentA.no_show_fee_cents], [shownA.consent.version, 4000, 6000]);
assert.ok(consentA.accepted_at && consentA.stripe_customer_id.startsWith("cus_") && consentA.stripe_payment_method_id.startsWith("pm_"), "consent time and only Stripe references are recorded");
const receiptA = await data(`/api/public/manage/${manageA}`);
assert.deepEqual([receiptA.payment.kind, receiptA.payment.paidCents, receiptA.payment.balanceDueCents, receiptA.payment.balanceDueAt, receiptA.payment.cardSaved], ["deposit", 2500, 7500, shownA.balanceDueAt, true]);
assert.deepEqual(receiptA.payment.cancellation, { outcome: "refund", amountCents: 2500 }, "the manage page states what cancelling now does");
await deliver();
const confirmationA = bookingMail(await state(), bookingA.id).find(mail => /^Confirmed:/.test(mail.subject));
assert.ok(textBody(confirmationA).includes("Deposit: $25.00 USD paid") && textBody(confirmationA).includes("Balance: $75.00 USD due by") && textBody(confirmationA).includes(receiptA.payment.balanceUrl), "the confirmation states the deposit, the balance, its due time and the balance link");
checks.push("a deposit booking shows $100 price, $25 due now and the $75 balance with its due time before booking, refuses to hold without consent, charges only the deposit, records consent with Stripe customer and card references, and the receipt, manage page and confirmation show the balance due and its link");

// The balance link (AUTH-007): forged and crossed tokens open nothing; one Checkout serves concurrent clicks; only the signed event settles it.
const balanceToken = new URL(receiptA.payment.balanceUrl).pathname.split("/").at(-1);
await call("/api/public/payments/balance/forged-capability", undefined, 404);
await call(`/api/public/payments/balance/${manageA}`, undefined, 404);
await call(`/api/public/payments/balance/${manageA}`, {}, 404);
assert.deepEqual(await data(`/api/public/payments/balance/${balanceToken}`).then(status => [status.state, status.balanceDueCents]), ["due", 7500]);
const clicks = await Promise.all(Array.from({ length: 5 }, () => data(`/api/public/payments/balance/${balanceToken}`, {})));
const first = clicks[0];
assert.ok(clicks.every(click => click.checkoutUrl === first.checkoutUrl), "simultaneous clicks share one balance Checkout");
assert.equal(calls(await state(), "/v1/checkout/sessions").filter(row => JSON.parse(row.body)["metadata[dial_movement_id]"]).length, 1, "exactly one balance Checkout Session is created, so the balance can only be paid once");
const balanceSession = await data("/__fixtures/payments/pay", { sessionId: sessionOf(first.checkoutUrl) });
assert.equal(balanceSession.amount_total, 7500);
assert.equal((await data(`/api/public/payments/balance/${balanceToken}`)).state, "due", "the return from Stripe alone settles nothing");
const balanceEvent = stripeEvent("checkout.session.completed", balanceSession);
await webhook(stripeEvent("checkout.session.completed", balanceSession, "acct_someoneelse"), 401);
await webhook(balanceEvent);
await webhook(balanceEvent);
snap = await state();
assert.deepEqual(snap.payment_movements.filter(row => row.booking_id === bookingA.id).map(row => [row.kind, row.status, row.amount_cents, row.actor_type]), [["balance", "succeeded", 7500, "invitee"]]);
assert.equal((await data(`/api/public/payments/balance/${balanceToken}`)).state, "paid");
await call(`/api/public/payments/balance/${balanceToken}`, {}, 409);
assert.deepEqual([(await data(`/api/public/manage/${manageA}`)).payment.paidCents, (await data(`/api/public/manage/${manageA}`)).payment.balanceDueCents], [10000, 0]);
checks.push("the balance link refuses forged and manage-link tokens, creates one Checkout for five simultaneous clicks, settles only on the signed event (a foreign account is 401, a duplicate adds nothing) and then reads paid");

// Cancellation inside the free window refunds everything paid, once, by the policy.
await call(`/api/public/manage/${manageA}/cancel`, { reason: "Plans changed" });
await call(`/api/public/manage/${manageA}/cancel`, { reason: "Plans changed" });
await webhook(balanceEvent);
await webhook(stripeEvent("checkout.session.completed", await data("/__fixtures/payments/pay", { sessionId: heldA.sessionId })));
snap = await state();
const refundsA = snap.payment_movements.filter(row => row.booking_id === bookingA.id && row.kind === "refund");
assert.deepEqual(refundsA.map(row => [row.status, row.amount_cents, row.actor_type]).sort(), [["succeeded", 2500, "policy"], ["succeeded", 7500, "policy"]]);
assert.equal(calls(snap, "/v1/refunds").length, 2, "one Stripe refund per captured payment, never repeated");
assert.ok(refundsA.every(row => row.processor_ref.startsWith("re_") && row.reason && JSON.parse(calls(snap, "/v1/refunds").find(call => JSON.parse(call.body)["metadata[dial_movement_id]"] === row.id).headers).idempotency === `dial-movement-${row.id}`), "each refund records its reason and Stripe reference and carries its idempotency key");
await deliver();
assert.ok(textBody(bookingMail(await state(), bookingA.id).find(mail => /^Booking cancelled:/.test(mail.subject) && mail.personalizations[0].to[0].email === "synthetic-dial-person+avery@example.test")).includes("$100.00 USD"), "the cancellation mail states the refund");
checks.push("an invitee cancellation ten days out refunds the $25 deposit and $75 balance automatically through two Stripe refunds; a repeated cancel and replayed signed events refund nothing more");

// A late cancellation charges the stated $40 fee once to the saved card and keeps the deposit.
const heldB = await hold("coaching", await slot("coaching", day(0), 3600000), "synthetic-dial-person+blake@example.test", "synthetic-dial-person+Blake Late", true);
const { manage: manageB, booking: bookingB } = await complete(heldB);
assert.deepEqual((await data(`/api/public/manage/${manageB}`)).payment.cancellation, { outcome: "late_fee", amountCents: 4000 });
await call(`/api/public/manage/${manageB}/cancel`, {});
await call(`/api/public/manage/${manageB}/cancel`, {});
snap = await state();
const feeCalls = calls(snap, "/v1/payment_intents");
assert.equal(feeCalls.length, 1, "the late fee is charged once");
const feeForm = JSON.parse(feeCalls[0].body), consentB = snap.booking_card_consents.find(row => row.booking_id === bookingB.id);
assert.deepEqual([feeForm.amount, feeForm.customer, feeForm.payment_method, feeForm.off_session, feeForm.confirm], [String(heldB.shown.consent.lateCancelFeeCents), consentB.stripe_customer_id, consentB.stripe_payment_method_id, "true", "true"], "the fee is exactly the amount shown, charged off-session to the consented card");
assert.deepEqual(snap.payment_movements.filter(row => row.booking_id === bookingB.id).map(row => [row.kind, row.status, row.amount_cents, row.actor_type]), [["late_cancel_fee", "succeeded", 4000, "policy"]]);
checks.push("a cancellation an hour before the start charges the shown $40 late fee once, off-session to the saved card, refunds nothing and a repeated cancel charges nothing more");

// A declined off-session charge is recorded as failed and never retried.
const heldC = await hold("coaching", await slot("coaching", day(0), 3600000), "synthetic-dial-person+casey@example.test", "synthetic-dial-person+Casey Declined", true);
const { manage: manageC, booking: bookingC } = await complete(heldC);
await data("/wire/control", { name: "stripe-card-decline", value: 1 });
await call(`/api/public/manage/${manageC}/cancel`, {});
await data("/wire/control", { name: "stripe-card-decline", value: 0 });
await call(`/api/public/manage/${manageC}/cancel`, {});
snap = await state();
assert.deepEqual(snap.payment_movements.filter(row => row.booking_id === bookingC.id).map(row => [row.kind, row.status, row.failure_code]), [["late_cancel_fee", "failed", "card_declined"]]);
assert.equal(calls(snap, "/v1/payment_intents").length, 2, "one attempt for the declined fee, no hidden second attempt");
checks.push("a declined late-fee charge is recorded failed with Stripe's code after one attempt and is never retried");

// A free event with a stated no-show fee saves the card through a SetupIntent; a no-show mark lets the host charge it once.
const heldD = await hold("consult", await slot("consult", day(3)), "synthetic-dial-person+dana@example.test", "synthetic-dial-person+Dana Noshow", true);
assert.deepEqual([heldD.shown.amountCents, heldD.shown.mode, heldD.step.payment.mode], [0, "setup", "setup"]);
const formD = JSON.parse(calls(await state(), "/v1/checkout/sessions").at(-1).body);
assert.deepEqual([formD.mode, formD.customer_creation, formD["line_items[0][price_data][unit_amount]"]], ["setup", "always", undefined], "nothing is charged at booking: Checkout only sets up the card");
const { booking: bookingD } = await complete(heldD);
snap = await state();
assert.equal(snap.booking_payments.filter(row => row.booking_id === bookingD.id).length, 0);
assert.ok(snap.booking_card_consents.find(row => row.booking_id === bookingD.id).stripe_payment_method_id.startsWith("pm_"), "the SetupIntent's card is saved with the consent");
assert.equal((await (await call(`/api/app/bookings/${bookingD.id}/no-show-fee`, {}, 409)).json()).error.code, "not_marked_no_show");
await call("/__fixtures/booking-ended", { id: bookingD.id }, 204);
await data(`/api/app/bookings/${bookingD.id}/attendance`, { status: "no_show", note: "Did not join" });
const charged = await data(`/api/app/bookings/${bookingD.id}/no-show-fee`, {});
await data(`/api/app/bookings/${bookingD.id}/no-show-fee`, {});
snap = await state();
assert.deepEqual(charged.money.movements.map(row => [row.kind, row.status, row.amountCents, row.actorType, row.actorId]), [["no_show_fee", "succeeded", 3000, "operator", operatorId]]);
assert.equal(calls(snap, "/v1/payment_intents").length, 3, "the no-show fee is charged once");
assert.deepEqual([charged.money.consent.consentTextVersion, charged.money.consent.noShowFeeCents, Boolean(charged.money.consent.acceptedAt)], [heldD.shown.consent.version, 3000, true], "the record shows the consent behind the charge");
checks.push("a free consultation saves the consented card through Stripe Checkout in setup mode with nothing charged; after the no-show mark the host charges the $30 no-show fee once with the consent on the record");

// A partial refund updates the booking record and the report.
const refundKey = randomUUID();
assert.equal((await (await call(`/api/app/bookings/${bookingD.id}/refunds`, { amountCents: 1000, reason: "", idempotencyKey: refundKey }, 400)).json()).error.code, "invalid_request");
assert.equal((await (await call(`/api/app/bookings/${bookingD.id}/refunds`, { amountCents: 5000, reason: "Too much", idempotencyKey: randomUUID() }, 400)).json()).error.code, "refund_exceeds_paid");
await data(`/api/app/bookings/${bookingD.id}/refunds`, { amountCents: 1000, reason: "Goodwill partial refund", idempotencyKey: refundKey });
await data(`/api/app/bookings/${bookingD.id}/refunds`, { amountCents: 1000, reason: "Goodwill partial refund", idempotencyKey: refundKey });
const recordD = await data(`/api/app/bookings/${bookingD.id}`);
assert.deepEqual([recordD.money.ledger.feesCents, recordD.money.ledger.refundedCents, recordD.money.ledger.netCents], [3000, 1000, 2000], "the record shows fee, refund and net");
assert.deepEqual(recordD.money.movements.filter(row => row.kind === "refund").map(row => [row.status, row.amountCents, row.actorType, row.actorId, row.reason]), [["succeeded", 1000, "operator", operatorId, "Goodwill partial refund"]], "a replayed refund request refunds once");
assert.deepEqual(recordD.history.filter(entry => entry.action.startsWith("payment_")).map(entry => [entry.action, entry.actorType, entry.actorId]), [["payment_no_show_fee", "operator", operatorId], ["payment_refund", "operator", operatorId]], "the booking history records each money movement and its actor");
const period = { fromDate: day(-1), throughDate: day(1) };
const report = Object.fromEntries((await data(`/api/app/reports/scheduling?${new URLSearchParams(period)}`)).tiles.map(tile => [tile.key, tile]));
const money = Object.fromEntries(report.revenue.figures.map(figure => [figure.key, figure.value]));
// Hand count of this journey: revenue $25 deposits for A, B and C plus A's $75 balance; fees B $40 and D $30 (C's charge failed);
// refunds A $100 and D $10.
assert.deepEqual(money, { revenue: 15000, fees: 7000, refunds: 11000, net: 11000 });
const drill = async bucket => (await data(`/api/app/bookings?${new URLSearchParams({ report: "revenue", bucket, periodFrom: period.fromDate, periodThrough: period.throughDate })}`)).map(row => row.inviteeName).sort();
assert.deepEqual(await drill("money:refunds"), ["synthetic-dial-person+Avery Deposit", "synthetic-dial-person+Dana Noshow"]);
assert.deepEqual(await drill("money:fees"), ["synthetic-dial-person+Blake Late", "synthetic-dial-person+Dana Noshow"]);
checks.push("a $10 partial refund needs a reason, never exceeds what was paid, refunds once on replay, and updates the booking record (fees $30, refunded $10, net $20) and the report's revenue, fees, refunds and net with drill-through to the bookings counted");

// Host-side cancellation (D4): an operator's, the host calendar's and an expired host request's cancellation each refund
// everything captured, once, charge no fee and void the open balance Checkout or invoice.
const movementsOf = (snapshot, id) => snapshot.payment_movements.filter(row => row.booking_id === id).map(row => [row.kind, row.status, row.amount_cents, row.actor_type, row.failure_code]).sort();
const cancelMail = async (id, email) => { await deliver(); return textBody(bookingMail(await state(), id).find(mail => /^Booking cancelled:/.test(mail.subject) && mail.personalizations[0].to[0].email === email)); };
const invoiceRefusal = async id => (await (await call(`/api/app/bookings/${id}/invoice`, {}, 409)).json()).error.details[0];
const heldF = await hold("coaching", await slot("coaching", day(14)), "synthetic-dial-person+frank@example.test", "synthetic-dial-person+Frank Hostcancel", true);
const { manage: manageF, booking: bookingF } = await complete(heldF);
assert.equal(await invoiceRefusal(bookingF.id), "paid_upfront", "an upfront-paid booking cannot be invoiced");
const balanceF = new URL((await data(`/api/public/manage/${manageF}`)).payment.balanceUrl).pathname.split("/").at(-1);
const openBalanceF = sessionOf((await data(`/api/public/payments/balance/${balanceF}`, {})).checkoutUrl);
const chargesBefore = calls(await state(), "/v1/payment_intents").length;
await call(`/api/app/bookings/${bookingF.id}/cancel`, { reason: "Host is unwell" });
await call(`/api/app/bookings/${bookingF.id}/cancel`, { reason: "Host is unwell" });
await webhook(stripeEvent("checkout.session.completed", await data("/__fixtures/payments/pay", { sessionId: heldF.sessionId })));
snap = await state();
assert.deepEqual(movementsOf(snap, bookingF.id), [["balance", "failed", 7500, "invitee", "voided"], ["refund", "succeeded", 2500, "operator", null]], "the deposit is refunded in full once and the open balance is voided");
const refundF = snap.payment_movements.find(row => row.booking_id === bookingF.id && row.kind === "refund");
assert.ok(refundF.actor_id === operatorId && refundF.reason && refundF.processor_ref.startsWith("re_"), "the refund records the operator, a reason and Stripe's reference");
assert.equal(calls(snap, "/v1/payment_intents").length, chargesBefore, "no fee is charged");
assert.equal(calls(snap, `/v1/checkout/sessions/${openBalanceF}/expire`).length, 1, "the open balance Checkout is expired at Stripe");
assert.equal((await data(`/api/public/payments/balance/${balanceF}`)).state, "cancelled");
assert.equal((await (await call(`/api/public/payments/balance/${balanceF}`, {}, 410)).json()).error.code, "balance_link_closed", "the balance link opens no new Checkout");
assert.equal(await invoiceRefusal(bookingF.id), "booking_cancelled", "a cancelled booking cannot be invoiced");
const mailF = await cancelMail(bookingF.id, "synthetic-dial-person+frank@example.test");
assert.ok(mailF.includes("refunds everything paid, $25.00 USD") && mailF.includes("No fee is charged") && mailF.includes("The balance is no longer due"), "the cancellation mail states the full refund, no fee and the void");
// Captures racing cancellation are exercised below while the Session is still open at Stripe.
checks.push("an operator cancelling a paid deposit booking refunds the $25 deposit in full once with no fee, expires the open balance Checkout and refuses the balance link and an invoice; the mail states the refund, no fee and the void");

// The operator may refund less, or nothing, only with a reason, which the invitee's mail states.
const heldG = await hold("coaching", await slot("coaching", day(15)), "synthetic-dial-person+gina@example.test", "synthetic-dial-person+Gina Partial", true);
const { booking: bookingG } = await complete(heldG);
assert.equal((await (await call(`/api/app/bookings/${bookingG.id}/cancel`, { refund: { amountCents: 1000, reason: "" } }, 400)).json()).error.code, "invalid_request", "a smaller refund needs a reason");
assert.equal((await (await call(`/api/app/bookings/${bookingG.id}/cancel`, { refund: { amountCents: 2501, reason: "Too much" } }, 400)).json()).error.code, "refund_exceeds_paid");
assert.equal((await data(`/api/app/bookings/${bookingG.id}`)).state, "confirmed", "a refused cancellation changes nothing");
await call(`/api/app/bookings/${bookingG.id}/cancel`, { reason: "Calendar change", refund: { amountCents: 1000, reason: "Preparation was already done" } });
await call(`/api/app/bookings/${bookingG.id}/cancel`, { reason: "Calendar change", refund: { amountCents: 1000, reason: "Preparation was already done" } });
snap = await state();
assert.deepEqual(movementsOf(snap, bookingG.id), [["refund", "succeeded", 1000, "operator", null]]);
assert.equal(snap.payment_movements.find(row => row.booking_id === bookingG.id).reason, "Preparation was already done");
const mailG = await cancelMail(bookingG.id, "synthetic-dial-person+gina@example.test");
assert.ok(mailG.includes("refunds $10.00 USD of the $25.00 USD paid") && mailG.includes("Reason: Preparation was already done"), "the mail states the amount refunded and the reason");
const heldH = await hold("coaching", await slot("coaching", day(15)), "synthetic-dial-person+hana@example.test", "synthetic-dial-person+Hana Norefund", true);
const { booking: bookingH } = await complete(heldH);
const refundsBeforeH = calls(await state(), "/v1/refunds").length;
await call(`/api/app/bookings/${bookingH.id}/cancel`, { refund: { amountCents: 0, reason: "Invitee asked to keep it as credit" } });
snap = await state();
assert.deepEqual([movementsOf(snap, bookingH.id), calls(snap, "/v1/refunds").length], [[], refundsBeforeH], "no refund reaches Stripe");
assert.ok((await cancelMail(bookingH.id, "synthetic-dial-person+hana@example.test")).includes("refunds nothing of the $25.00 USD paid. Reason: Invitee asked to keep it as credit"));
checks.push("an operator refunding less ($10 of $25) or nothing must give a reason, cannot exceed what was paid, refunds once on a repeated cancel, and the invitee's mail states the amount and the reason");

// The host's calendar deletion and an expired host reschedule request refund in full, once, by Dial's policy.
const heldI = await hold("coaching", await slot("coaching", day(16)), "synthetic-dial-person+iris@example.test", "synthetic-dial-person+Iris Calendar", true);
const { booking: bookingI } = await complete(heldI);
await deliver();
const eventI = (await state()).bookings.find(row => row.id === bookingI.id).calendar_provider_event_id;
await data("/wire/delete", { id: eventI }); await data("/wire/delete", { id: eventI });
snap = await state();
assert.equal(snap.bookings.find(row => row.id === bookingI.id).state, "cancelled");
assert.deepEqual(movementsOf(snap, bookingI.id), [["refund", "succeeded", 2500, "policy", null]], "a calendar deletion refunds the deposit once");
assert.ok((await cancelMail(bookingI.id, "synthetic-dial-person+iris@example.test")).includes("refunds everything paid, $25.00 USD"));
const heldJ = await hold("coaching", await slot("coaching", day(17)), "synthetic-dial-person+jules@example.test", "synthetic-dial-person+Jules Expiry", true);
const { booking: bookingJ } = await complete(heldJ);
await deliver();
const requestJ = await data(`/api/app/bookings/${bookingJ.id}/reschedule-request`, { message: "Please pick another time.", releaseTime: true, expiresInDays: 1, reminderHours: null });
const expiryJ = new Date(Date.parse(requestJ.rescheduleRequest.expiresAt) + 1000).toISOString();
await call("/__fixtures/request-time", { id: bookingJ.id, now: expiryJ }, 204); await call("/__fixtures/request-time", { id: bookingJ.id, now: expiryJ }, 204);
snap = await state();
assert.equal(snap.bookings.find(row => row.id === bookingJ.id).state, "cancelled");
assert.deepEqual(movementsOf(snap, bookingJ.id), [["refund", "succeeded", 2500, "policy", null]], "an expired host request refunds the deposit once");
checks.push("a booking cancelled by the host's Google Calendar deletion, and one cancelled by an expired host reschedule request, each refund the $25 deposit in full once with no fee, and replays refund nothing more");

// Cancelling voids an open invoice at Stripe; an invoice Stripe marked paid before the void is recorded and refunded once.
const invoiced = async (name, email, offset) => {
  const booking = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(offset)), inviteeTimezone: "UTC", name, email, answers: {} }, 201);
  return { booking, invoice: (await data(`/api/app/bookings/${booking.id}/invoice`, {})).invoice };
};
const voided = await invoiced("synthetic-dial-person+Kim Invoice", "synthetic-dial-person+kim@example.test", 18);
await call(`/api/app/bookings/${voided.booking.id}/cancel`, {});
snap = await state();
assert.equal(JSON.parse(snap.wire_stripe_objects.find(row => row.id === voided.invoice.id).payload).status, "void", "the open invoice is voided at Stripe");
assert.deepEqual(movementsOf(snap, voided.booking.id), [["invoice", "failed", 10000, "operator", "voided"]]);
await call("/__fixtures/payments/pay-invoice", { invoiceId: voided.invoice.id }, 404);
assert.ok((await cancelMail(voided.booking.id, "synthetic-dial-person+kim@example.test")).includes("The open invoice is void and can no longer be paid"));
const raced = await invoiced("synthetic-dial-person+Lou Invoice", "synthetic-dial-person+lou@example.test", 19);
const racedPaid = await data("/__fixtures/payments/pay-invoice", { invoiceId: raced.invoice.id });
await call(`/api/app/bookings/${raced.booking.id}/cancel`, {});
const racedEvent = stripeEvent("invoice.paid", racedPaid);
await webhook(racedEvent); await webhook(racedEvent);
snap = await state();
assert.deepEqual(movementsOf(snap, raced.booking.id), [["invoice", "succeeded", 10000, "operator", null], ["refund", "succeeded", 10000, "policy", null]], "invoice.paid on a cancelled booking is recorded and refunded once, never silently settled");
assert.equal(calls(snap, "/v1/refunds").filter(row => JSON.parse(row.body).payment_intent === racedPaid.payment_intent).length, 1);
checks.push("cancelling an invoiced booking voids its open Stripe invoice so it can no longer be paid; an invoice paid at Stripe before the void reached it is recorded on invoice.paid and refunded in full once, a replayed event refunding nothing more");

// sd-dial-c9: exercise the four source-review suspects through the real public/operator doors.
const probeFailures = [];
async function probe(name, run) {
  try { await run(); checks.push(`${name}: passed`); console.log(`PROBE ${name}: PASS`); }
  catch (error) { probeFailures.push({ name, message: error.message }); console.log(`PROBE ${name}: FAIL ${redact(error.message)}`); }
}
await probe("stale fee consent", async () => {
  const startAt = await slot("coaching", day(20));
  const selection = await data("/api/public/book/dial-host/coaching/selection", { startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
  const shown = (await data(`/api/public/book/dial-host/coaching/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`)).payment;
  assert.equal(shown.consent.lateCancelFeeCents, 4000);
  await data(`/api/app/event-types/${coaching.id}/payment-terms`, { ...terms, lateCancelFeeCents: 9000 }, 200, "PUT");
  const response = await call("/api/public/book/dial-host/coaching/confirm", { nonce: selection.nonce, startAt, durationMinutes: 60, inviteeTimezone: "UTC", name: "synthetic-dial-person+1", email: "synthetic-dial-person+1@example.test", answers: {}, cardConsent: { accepted: true, version: shown.consent.version } }, [400, 202]);
  // Refuse before any Checkout can collect money; the refreshed step must show the new fee.
  assert.equal(response.status, 400, "the original $40 consent must not accept the host's new $90 fee");
  assert.equal((await response.json()).error.code, "card_consent_required");
  const refreshed = (await data(`/api/public/book/dial-host/coaching/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`)).payment;
  assert.equal(refreshed.consent.lateCancelFeeCents, 9000);
  assert.notEqual(refreshed.consent.version, shown.consent.version);
});
await data(`/api/app/event-types/${coaching.id}/payment-terms`, terms, 200, "PUT");
await probe("pending refund and later failure", async () => {
  const held = await hold("coaching", await slot("coaching", day(21)), "synthetic-dial-person+2@example.test", "synthetic-dial-person+2", true);
  const { booking, manage } = await complete(held);
  await data("/wire/control", { name: "stripe-refund-pending", value: 1 });
  await call(`/api/app/bookings/${booking.id}/cancel`, {});
  const current = await state();
  const movement = current.payment_movements.find(row => row.booking_id === booking.id && row.kind === "refund");
  assert.equal(movement.status, "pending", "Stripe pending is not a completed refund");
  assert.ok(movement.processor_ref, "a pending refund retains its processor reference");
  assert.equal((await data(`/api/app/bookings/${booking.id}/money`)).money.ledger.refundedCents, 0);
  assert.equal((await data(`/api/public/manage/${manage}`)).payment.refundedCents, 0, "the receipt reports no refund before completion");
  assert.ok((await cancelMail(booking.id, held.payload.email)).includes("refund request"), "cancellation mail distinguishes a request from a completed refund");
  const refund = JSON.parse(current.wire_stripe_objects.find(row => row.id === movement.processor_ref).payload);
  const failed = stripeEvent("refund.failed", { ...refund, status: "failed", failure_reason: "lost_or_stolen_card" });
  await webhook(stripeEvent("refund.failed", { ...refund, status: "failed" }, "acct_someoneelse"), 401);
  await webhook(failed); await webhook(failed);
  const after = (await data(`/api/app/bookings/${booking.id}/money`)).money;
  assert.deepEqual(after.movements.filter(row => row.kind === "refund").map(row => [row.status, row.failureCode]), [["failed", "refund_failed"]]);
  assert.equal(after.ledger.refundedCents, 0);
});
await data("/wire/control", { name: "stripe-refund-pending", value: 0 });
await probe("transient refund response recovers once", async () => {
  const held = await hold("coaching", await slot("coaching", day(22)), "synthetic-dial-person+3@example.test", "synthetic-dial-person+3", true);
  const { booking } = await complete(held);
  await data("/wire/control", { name: "stripe-refund-unavailable", value: 1 });
  await call(`/api/app/bookings/${booking.id}/cancel`, {});
  const pending = (await data(`/api/app/bookings/${booking.id}/money`)).money.movements.find(row => row.kind === "refund");
  assert.equal(pending.status, "pending");
  await data("/wire/control", { name: "stripe-refund-unavailable", value: 0 });
  // A repeated cancellation is a public-door retry, sharing the pending movement's original key.
  await call(`/api/app/bookings/${booking.id}/cancel`, {});
  await call(`/api/app/bookings/${booking.id}/cancel`, {});
  const current = await state(), moves = current.payment_movements.filter(row => row.booking_id === booking.id && row.kind === "refund");
  assert.deepEqual(moves.map(row => [row.id, row.status, row.amount_cents]), [[pending.id, "succeeded", 2500]]);
  const requests = calls(current, "/v1/refunds").filter(row => JSON.parse(row.body)["metadata[dial_booking_id]"] === booking.id);
  assert.equal(requests.length, 2);
  assert.equal(new Set(requests.map(row => JSON.parse(row.headers).idempotency)).size, 1);
});
await data("/wire/control", { name: "stripe-refund-unavailable", value: 0 });
await probe("lost invoice finalization response", async () => {
  const booking = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(23)), inviteeTimezone: "UTC", name: "synthetic-dial-person+4", email: "synthetic-dial-person+4@example.test", answers: {} }, 201);
  await data("/wire/control", { name: "stripe-finalize-response-lost", value: 1 });
  await call(`/api/app/bookings/${booking.id}/invoice`, {}, [409, 502, 503]);
  await data("/wire/control", { name: "stripe-finalize-response-lost", value: 0 });
  const current = await state(), provider = current.wire_stripe_objects.map(row => JSON.parse(row.payload)).find(row => row.object === "invoice" && row.metadata?.dial_booking_id === booking.id);
  assert.equal(provider.status, "open", "finalization succeeded at Stripe despite the lost response");
  // The same fault with no payment yet must void the provider invoice, not merely its local movement.
  const unpaid = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(24)), inviteeTimezone: "UTC", name: "synthetic-dial-person+5", email: "synthetic-dial-person+5@example.test", answers: {} }, 201);
  await data("/wire/control", { name: "stripe-finalize-response-lost", value: 1 });
  await call(`/api/app/bookings/${unpaid.id}/invoice`, {}, 503);
  await data("/wire/control", { name: "stripe-finalize-response-lost", value: 0 });
  const remoteUnpaid = (await state()).wire_stripe_objects.map(row => JSON.parse(row.payload)).find(row => row.object === "invoice" && row.metadata?.dial_booking_id === unpaid.id);
  await call(`/api/app/bookings/${unpaid.id}/cancel`, {});
  assert.equal(JSON.parse((await state()).wire_stripe_objects.find(row => row.id === remoteUnpaid.id).payload).status, "void");
  await call("/__fixtures/payments/pay-invoice", { invoiceId: remoteUnpaid.id }, 404);
  // Capture before cancellation, but delay the event until after the void attempt.
  const paid = await data("/__fixtures/payments/pay-invoice", { invoiceId: provider.id });
  await call(`/api/app/bookings/${booking.id}/cancel`, {});
  const event = stripeEvent("invoice.paid", paid);
  await webhook(event); await webhook(event);
  const after = (await data(`/api/app/bookings/${booking.id}/money`)).money;
  assert.deepEqual([after.ledger.paidCents, after.ledger.refundedCents], [10000, 10000], "the lost finalization response must not hide a payment after cancellation");
  assert.equal(after.movements.filter(row => row.kind === "refund").length, 1);
});
await data("/wire/control", { name: "stripe-finalize-response-lost", value: 0 });
await cancellationProbes({ data, call, state, hold, complete, slot, day, webhook, stripeEvent, sessionOf, deliver, coaching });

// Erasing a payer asks Stripe to detach the saved card, removes references and consent, and keeps amounts in the anonymized audit.
const preview = await data("/api/app/privacy/preview", { email: "synthetic-dial-person+avery@example.test" });
const receipt = await data("/api/app/privacy/erase", { email: "synthetic-dial-person+avery@example.test", confirmation: preview.confirmation, expiresAt: preview.expiresAt });
snap = await state();
assert.equal(calls(snap, `/v1/payment_methods/${consentA.stripe_payment_method_id}/detach`).length, 1, "Stripe is asked to detach the saved card");
assert.deepEqual([receipt.savedCardsDetached, receipt.savedCardFailures, receipt.stripeCustomersRetained], [1, 0, 1], "the receipt counts the detached card and observed Stripe Customer");
assert.ok(receipt.externalRequests.some(item=>item.kind==="stripe_customer_anonymize"&&item.processorRef===consentA.stripe_customer_id&&item.state==="completed"),"the receipt reports the actual Customer anonymization");
const retainedRows=await data("/__fixtures/payments/all-rows"),rows=JSON.stringify(retainedRows);
for(const detail of ["synthetic-dial-person+avery@example.test","synthetic-dial-person+Avery Deposit"])assert.ok(!rows.includes(detail),"erased payer values are gone from every table");
for(const [table,records] of Object.entries(retainedRows))if(!["anonymized_audit","processor_erasure_requests"].includes(table))for(const ref of [consentA.stripe_payment_method_id,consentA.stripe_customer_id])assert.ok(!JSON.stringify(records).includes(ref),`${table}: processor references survive only in anonymous audit/cleanup records`);
const audit = snap.anonymized_audit.filter(row => row.entity_kind === "payment").map(row => [row.action, row.amount_cents]).sort();
assert.deepEqual(audit, [["balance:succeeded", 7500], ["deposit", 2500], ["refund:succeeded", 2500], ["refund:succeeded", 7500], ["saved_card_detached", 0]], "amounts and Stripe references survive anonymized");
checks.push("erasing a payer detaches the saved card at Stripe, deletes consent, card references and movements with the booking, and keeps each amount and Stripe reference in the anonymized audit; the receipt counts the detached card");

await paymentErasureProbes({ data, call, state, hold, slot, day, webhook, stripeEvent, coaching, probe, complete, deliver });
await reconciliationProbes({call,data,state,hold,slot,day,complete,webhook,stripeEvent,signature,probe});
assert.deepEqual(probeFailures, [], "all money source-review probes pass");

// Fail closed: with the connection deauthorized, refunds and fees are refused and an automatic refund is recorded failed, never done.
const heldE = await hold("coaching", await slot("coaching", day(12)), "synthetic-dial-person+erin@example.test", "synthetic-dial-person+Erin Closed", true);
const { manage: manageE, booking: bookingE } = await complete(heldE);
await webhook(stripeEvent("account.application.deauthorized", { id: "ca_wire", object: "application" }));
const refusedRefund = await (await call(`/api/app/bookings/${bookingB.id}/refunds`, { amountCents: 500, reason: "Courtesy", idempotencyKey: randomUUID() }, 409)).json();
assert.deepEqual([refusedRefund.error.code, refusedRefund.error.details], ["payments_unavailable", ["stripe_deauthorized"]]);
const refundsBefore = calls(await state(), "/v1/refunds").length;
await call(`/api/public/manage/${manageE}/cancel`, {});
snap = await state();
assert.deepEqual(snap.payment_movements.filter(row => row.booking_id === bookingE.id).map(row => [row.kind, row.status, row.failure_code]), [["refund", "failed", "stripe_deauthorized"]]);
assert.equal(calls(snap, "/v1/refunds").length, refundsBefore, "nothing reaches Stripe");
assert.equal(snap.payment_movements.filter(row => row.booking_id === bookingB.id && row.kind === "refund").length, 0, "a refused refund records nothing");
checks.push("after Stripe deauthorizes Dial, a host refund is refused with payments_unavailable/stripe_deauthorized and records nothing; an invitee's free-window refund is recorded failed with that reason and never reaches Stripe");

await writeFile(evidencePath("payment-terms-wire.json"), JSON.stringify({ title: "PAY-003 deposits, refunds and cancellation or no-show fees move money once, only as shown", checks, scope: "Native local D1 and production services with Stripe API and signed webhooks synthetic at the HTTP edge" }, null, 2));
console.log("PAY-003 deposits, refunds and fees journey passed.");
