import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { bookingMail, recipient, textBody } from "./mail-contracts.mjs";

// PAY-001 through the public door, with Stripe synthetic at the HTTP edge (tests/booking-wire/stripe-wire.ts).
// The webhook signing secret and session secret are the synthetic test values in worker.wrangler.toml.
const origin = process.env.DIAL_REVIEW_ORIGIN, webhookSecret = "whsec_wiretest", sessionSecret = "synthetic-dial-booking-wire-synthetic-local-session-secret";
const redact = text => text.replace(/\/manage\/[^/?\s"'<>]+/gu, "/manage/[redacted]").replace(/return=[^&\s"']+/gu, "return=[redacted]");
let cookie;
const checks = [];
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST", headers = {}) {
  const raw = typeof body === "string";
  const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie && !headers.anonymous ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), redirect: "manual" });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${redact(path)} ${response.status}: ${redact(await response.clone().text())}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const base64url = value => Buffer.from(value).toString("base64url");
const signState = value => { const body = base64url(JSON.stringify(value)); return `${body}.${createHmac("sha256", `${sessionSecret}:stripe-connect.v1`).update(body).digest("base64url")}`; };
const signature = (payload, timestamp = Math.floor(Date.now() / 1000), secret = webhookSecret) => `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
const stripeEvent = (type, object, account = "acct_wirehost") => JSON.stringify({ id: `evt_${type.replaceAll(".", "_")}_${object.id ?? "account"}`, object: "event", type, account, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
const webhook = (payload, expected = 200, header = signature(payload)) => call("/api/webhooks/stripe", payload, expected, "POST", { "content-type": "application/json", ...(header ? { "stripe-signature": header } : {}), anonymous: "1" });
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Payments owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await data("/__fixtures/setup", {});
await data("/wire/control", { name: "google-conference", value: "success" });

// S1 connect: Stripe Connect Standard OAuth under AUTH-004's state rules.
const setup = await data("/api/app/payments/stripe");
assert.deepEqual({ state: setup.state, configured: setup.configured, redirectUri: setup.redirectUri, webhookUrl: setup.webhookUrl }, { state: "disconnected", configured: true, redirectUri: `${origin}/api/payments/stripe/oauth/callback`, webhookUrl: `${origin}/api/webhooks/stripe` });
const begin = async () => new URL((await call("/api/app/payments/stripe/oauth/start", undefined, 302)).headers.get("location"));
const authorize = await begin();
assert.equal(authorize.origin + authorize.pathname, "https://connect.stripe.com/oauth/authorize");
assert.deepEqual(["response_type", "client_id", "scope", "redirect_uri"].map(key => authorize.searchParams.get(key)), ["code", "ca_wire", "read_write", setup.redirectUri]);
const good = authorize.searchParams.get("state"), [goodBody] = good.split(".");
const issued = JSON.parse(Buffer.from(goodBody, "base64url").toString());
const callback = (query, expected, headers) => call(`/api/payments/stripe/oauth/callback?${new URLSearchParams(query)}`, undefined, expected, "GET", headers);
await callback({ code: "wire-stripe-consent" }, 400);
await callback({ code: "wire-stripe-consent", state: `${goodBody}.forged` }, 400);
await callback({ code: "wire-stripe-consent", state: signState({ ...issued, sessionId: "another-operator-session" }) }, 400);
await callback({ code: "wire-stripe-consent", state: good }, 400, { anonymous: "1" });
const stale = await begin();
await call("/__fixtures/payments/oauth-expired", {}, 204);
await callback({ code: "wire-stripe-consent", state: stale.searchParams.get("state") }, 400);
assert.equal((await state()).payment_connections.length, 0, "refused OAuth states connect nothing");
const fresh = await begin();
assert.match((await callback({ code: "wire-stripe-consent", state: fresh.searchParams.get("state") }, 302)).headers.get("location"), /^\/(app|setup)\/settings\?stripe=connected$/);
await callback({ code: "wire-stripe-consent", state: fresh.searchParams.get("state") }, 400);
let snap = await state();
assert.deepEqual(snap.payment_connections.map(row => [row.account_id, row.status]), [["acct_wirehost", "connected"]]);
assert.ok(!JSON.stringify(snap.payment_connections).includes("dial-never-stores"), "only the connected account ID is stored");
checks.push("Connect Standard OAuth: missing, unsigned, mismatched, anonymous, expired and replayed state return 400 and connect nothing; a valid state stores only acct_wirehost");

// S2 price: a USD price, or a price per offered duration (EVENT-011).
const paid = await data("/api/app/event-types", { slug: "paid-session", title: "Paid strategy session", description: "A paid working session.", durationMinutes: 30, durationOptionsMinutes: [30, 60], color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
await call(`/api/app/event-types/${paid.id}/price`, { amountCents: null, durationPrices: [{ durationMinutes: 30, amountCents: 4000 }] }, 400, "PUT");
await call(`/api/app/event-types/${paid.id}/price`, { amountCents: 5000, durationPrices: [{ durationMinutes: 45, amountCents: 7000 }] }, 400, "PUT");
assert.deepEqual(await data(`/api/app/event-types/${paid.id}/price`, { amountCents: 5000, durationPrices: [{ durationMinutes: 60, amountCents: 9000 }] }, 200, "PUT"), { amountCents: 5000, durationPrices: [{ durationMinutes: 60, amountCents: 9000 }], currency: "usd" });
await data(`/api/app/event-types/${paid.id}/publish`, {});
assert.deepEqual((await data("/api/public/events/dial-host/paid-session")).eventType.price, { amountCents: 5000, durationPrices: [{ durationMinutes: 60, amountCents: 9000 }], currency: "usd" });
assert.equal((await data("/api/public/events/dial-host/intro")).eventType.price, undefined, "free event types are unchanged");
const book = "/api/public/book/dial-host/paid-session";
const slots = async duration => (await data(`${book}/availability?week=${future}&durationMinutes=${duration}`)).slots.map(slot => slot.startAt);
async function hold(startAt, duration, email, name = "Paying guest") {
  const selection = await data(`${book}/selection`, { startAt, inviteeTimezone: "UTC", durationMinutes: duration }, 201);
  const payload = { nonce: selection.nonce, startAt, durationMinutes: duration, inviteeTimezone: "UTC", name, email, answers: {} };
  const step = await data(`${book}/confirm`, payload, 202);
  return { selection, payload, step, returnToken: new URL(step.payment.returnUrl).searchParams.get("return") };
}

// S2/S3: the pay step holds the slot through the BOOK-002 claim and opens Stripe Checkout for the chosen duration's price.
const [first, second] = await slots(60);
const lookupSelection = await data(`${book}/selection`, { startAt: first, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
const shown = (await data(`${book}/selection?${new URLSearchParams({ nonce: lookupSelection.nonce, startAt: first, inviteeTimezone: "UTC" })}`)).payment;
assert.deepEqual([shown.amountCents, shown.currency, shown.priceCents, shown.balanceCents, shown.freeWindowEndsAt, shown.consent], [9000, "usd", 9000, 0, null, undefined], "the full price is due now and no fee or consent applies");
assert.ok(shown.policy.length, "the booking step states that the event has no cancellation policy");
const payer = await hold(first, 60, "payer@dial.test", "Avery Payer");
assert.equal(payer.step.paymentRequired, true);
assert.equal(payer.step.payment.amountCents, 9000);
snap = await state();
const session = JSON.parse(snap.wire_stripe_sessions[0].payload);
const create = snap.wire_calls.find(row => new URL(row.url).pathname === "/v1/checkout/sessions");
const form = JSON.parse(create.body), sent = JSON.parse(create.headers);
assert.equal(form["line_items[0][price_data][unit_amount]"], "9000", "the 60-minute option's own price is charged");
assert.equal(form["line_items[0][price_data][currency]"], "usd");
assert.equal(form["excluded_payment_method_types[0]"], "us_bank_account", "ACH Direct Debit is offered only when the host enables it");
assert.equal(sent.account, "acct_wirehost"); assert.ok(sent.idempotency.startsWith("dial-hold-"));
assert.equal(payer.step.payment.checkoutUrl, session.url);
assert.equal(snap.bookings.filter(row => row.event_slug === "paid-session").length, 0, "nothing confirms before Stripe's signed event");
assert.deepEqual(snap.payment_holds.map(row => [row.state, row.amount_cents]), [["held", 9000]]);
assert.equal(Date.parse(snap.payment_holds[0].expires_at) - Date.parse(snap.payment_holds[0].created_at), 10 * 60000, "the default payment window is ten minutes");
assert.ok(!(await slots(60)).includes(first), "a held slot is not offered");
await call(`${book}/selection`, { startAt: first, inviteeTimezone: "UTC", durationMinutes: 60 }, 409);
await call(`${book}/confirm`, { ...lookupSelection && { nonce: lookupSelection.nonce }, startAt: first, durationMinutes: 60, inviteeTimezone: "UTC", name: "Second payer", email: "second-payer@dial.test", answers: {} }, 409);
assert.equal((await data(`${book}/confirm`, payer.payload, 202)).payment.checkoutUrl, session.url, "a replayed pay step returns the same Checkout Session");
assert.equal((await state()).wire_stripe_sessions.length, 1);
checks.push("paid confirm returns 202 with Stripe Checkout for $90 (60-minute price), holds the slot for 10 minutes, offers it to nobody else and a second payer gets 409; a replay reuses the session");

// S3: the return URL alone never confirms; forged and unknown return capabilities change nothing.
assert.equal((await data(`/api/public/payments/${payer.returnToken}`)).state, "held");
// The return page reads only this capability; Stripe's session_id in its query is ignored.
await call(`/api/public/payments/${payer.returnToken}?session_id=${session.id}`, undefined, 200);
await call(`/api/public/payments/forged-capability?session_id=${session.id}`, undefined, 404);
await data("/__fixtures/payments/pay", { sessionId: session.id });
assert.equal((await data(`/api/public/payments/${payer.returnToken}?session_id=${session.id}&paid=1`)).state, "held");
snap = await state();
assert.equal(snap.bookings.filter(row => row.event_slug === "paid-session").length, 0, "a paid session's return URL confirms nothing");
assert.equal(snap.payment_holds[0].state, "held");
checks.push("a forged or real return URL with Stripe's session_id confirms nothing; unknown return capabilities are 404");

// S3 AUTH-005: bad, missing or stale signatures and a foreign connected account return 401 and change nothing.
const paidSession = (await data("/__fixtures/payments/pay", { sessionId: session.id }));
const completed = stripeEvent("checkout.session.completed", paidSession);
await webhook(completed, 401, signature(completed, undefined, "whsec_wrongsecret"));
await webhook(completed, 401, null);
await webhook(completed, 401, signature(completed, Math.floor(Date.now() / 1000) - 600));
await webhook(stripeEvent("checkout.session.completed", paidSession, "acct_someoneelse"), 401);
await webhook(stripeEvent("checkout.session.completed", { ...paidSession, amount_total: 100 }), 400);
snap = await state();
assert.equal(snap.bookings.filter(row => row.event_slug === "paid-session").length, 0);
assert.equal(snap.payment_holds[0].state, "held");
checks.push("wrong secret, missing signature, timestamp outside 300 s and a foreign connected account return 401; a mismatched amount returns 400; none confirms");

// S3: Stripe's signed checkout.session.completed confirms once; duplicates and payment_intent.succeeded confirm nothing more.
await webhook(completed);
await webhook(completed);
await webhook(stripeEvent("payment_intent.succeeded", { id: paidSession.payment_intent, object: "payment_intent", amount_received: 9000, currency: "usd", status: "succeeded", metadata: { dial_hold_id: paidSession.metadata.dial_hold_id } }));
await deliver();
snap = await state();
const paidBookings = snap.bookings.filter(row => row.event_slug === "paid-session");
assert.equal(paidBookings.length, 1, "a duplicated webhook confirms once");
assert.equal(paidBookings[0].state, "confirmed"); assert.equal(paidBookings[0].duration_minutes, 60);
assert.deepEqual(snap.booking_payments.map(row => [row.booking_id, row.amount_cents, row.currency, row.checkout_session_id, row.payment_intent_id, row.account_id]), [[paidBookings[0].id, 9000, "usd", session.id, paidSession.payment_intent, "acct_wirehost"]]);
assert.deepEqual(snap.payment_holds.map(row => [row.state, row.booking_id, row.claim_json, row.invitee_email_folded]), [["confirmed", paidBookings[0].id, null, null]]);
const confirmations = bookingMail(snap, paidBookings[0].id).filter(mail => /^Confirmed:|^New booking:/.test(mail.subject));
assert.deepEqual(confirmations.flatMap(recipient).sort(), ["operator@dial.test", "payer@dial.test"], "one confirmation per party");
for (const mail of confirmations) assert.ok(textBody(mail).includes(`Payment: $90.00 USD paid · Stripe reference ${session.id}`), "BOOK-005 confirmation mail shows the amount and Stripe reference");
checks.push("signed checkout.session.completed confirms one 60-minute booking with a $90 payment record; duplicate completed and payment_intent.succeeded events add nothing; one confirmation mail each with amount and reference");

// S4: receipt, manage page and the operator booking record show the amount and the Stripe reference.
const returned = await data(`/api/public/payments/${payer.returnToken}`);
assert.equal(returned.state, "confirmed");
const manage = new URL(returned.manageUrl).pathname.split("/").at(-1);
const receipt = await data(`/api/public/manage/${manage}`);
assert.deepEqual([receipt.payment.amountCents, receipt.payment.currency, receipt.payment.reference, receipt.payment.kind, receipt.payment.paidCents, receipt.payment.refundedCents, receipt.payment.balanceDueCents], [9000, "usd", session.id, "payment", 9000, 0, 0]);
assert.deepEqual(receipt.payment.cancellation, { outcome: "none", amountCents: 0 }, "without a cancellation policy, cancelling moves no money");
assert.deepEqual((await data(`${book}/confirm`, payer.payload, 200)).manageUrl, returned.manageUrl, "a replayed confirmation returns the paid receipt");
const record = await data(`/api/app/bookings/${paidBookings[0].id}`);
assert.deepEqual([record.payment.amountCents, record.payment.checkoutSessionId, record.payment.paymentIntentId], [9000, session.id, paidSession.payment_intent]);
checks.push("receipt, manage page and operator booking record show $90 and the Stripe reference; the return page opens the receipt only after confirmation");

// S3: an expired payment window releases the hold through Stripe and creates no booking; a Stripe-reported expiry does too.
const lapsed = await hold(second, 30, "lapsed@dial.test", "Lapsed Payer");
assert.equal(lapsed.step.payment.amountCents, 5000, "a duration without its own price uses the event price");
snap = await state();
const lapsedHold = snap.payment_holds.find(row => row.state === "held");
await call("/__fixtures/payments/window-ended", { holdId: lapsedHold.id }, 204);
snap = await state();
assert.ok(snap.wire_calls.some(row => row.method === "POST" && new URL(row.url).pathname === `/v1/checkout/sessions/${lapsedHold.checkout_session_id}/expire`), "Dial expires the Checkout Session itself");
assert.deepEqual(snap.payment_holds.filter(row => row.id === lapsedHold.id).map(row => [row.state, row.ended_reason, row.claim_json]), [["released", "payment_window_expired", null]]);
assert.ok((await slots(30)).includes(second), "the released slot is offered again");
assert.equal((await data(`/api/public/payments/${lapsed.returnToken}`)).state, "released");
await call(`${book}/confirm`, lapsed.payload, 410);
const abandoned = await hold(second, 30, "abandoned@dial.test", "Abandoned Payer");
snap = await state();
const abandonedHold = snap.payment_holds.find(row => row.state === "held");
await webhook(stripeEvent("checkout.session.expired", { id: abandonedHold.checkout_session_id, object: "checkout.session", status: "expired", metadata: { dial_hold_id: abandonedHold.id } }));
snap = await state();
assert.equal(snap.payment_holds.find(row => row.id === abandonedHold.id).state, "released");
assert.equal(snap.bookings.filter(row => ["lapsed@dial.test", "abandoned@dial.test"].includes(row.invitee_email)).length, 0, "abandoned and expired payments create no booking");
assert.equal((await data(`/api/public/payments/${abandoned.returnToken}`)).state, "released");
checks.push("a lapsed 10-minute window expires the Stripe session and frees the slot; Stripe's checkout.session.expired releases an abandoned hold; neither creates a booking");

// S4: reschedule keeps the amount paid; cancel keeps the payment record and states that Dial issues no refund.
const options = await data(`/api/public/manage/${manage}/reschedule/availability?week=${future}&durationMinutes=60`);
const moveTo = options.slots.find(slot => slot.startAt !== first && slot.startAt !== second).startAt;
const moveSelection = await data(`/api/public/manage/${manage}/reschedule/selection`, { startAt: moveTo, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
const moved = await data(`/api/public/manage/${manage}/reschedule`, { nonce: moveSelection.nonce, startAt: moveTo, inviteeTimezone: "UTC", durationMinutes: 60 });
assert.deepEqual(moved.payment, receipt.payment, "a reschedule keeps the amount paid");
await deliver();
const cancelled = await data(`/api/public/manage/${manage}/cancel`, { reason: "Plans changed" });
const kept = Object.fromEntries(Object.entries(receipt.payment).filter(([key]) => key !== "cancellation"));
assert.equal(cancelled.state, "cancelled"); assert.deepEqual(cancelled.payment, kept, "cancel does not drop the payment record");
await deliver();
snap = await state();
assert.equal(snap.booking_payments.length, 1);
assert.deepEqual([snap.payment_movements.length, snap.wire_calls.filter(row => new URL(row.url).pathname === "/v1/refunds").length], [0, 0], "with no cancellation policy, Dial issues no automatic refund (PAY-003)");
const changeMail = bookingMail(snap, paidBookings[0].id).filter(mail => /^Rescheduled:|^Booking cancelled:/.test(mail.subject));
assert.equal(changeMail.length, 4);
for (const mail of changeMail) {
  assert.equal(textBody(mail).split("$90.00 USD").length - 1, 1, `${mail.subject} states the retained amount once`);
  assert.ok(textBody(mail).includes(session.id), `${mail.subject} keeps the processor reference`);
}
checks.push("reschedule keeps $90 paid; cancel keeps the payment record and, with no cancellation policy, issues no refund; change and cancellation mail state the payment kept");

// S1: account.application.deauthorized marks the connection unhealthy and stops new paid bookings with a named reason.
await webhook(stripeEvent("account.application.deauthorized", { id: "ca_wire", object: "application" }, "acct_someoneelse"), 401);
assert.equal((await state()).payment_connections[0].status, "connected");
await webhook(stripeEvent("account.application.deauthorized", { id: "ca_wire", object: "application" }));
assert.equal((await data("/api/app/payments/stripe")).state, "deauthorized");
const refused = await (await call(`${book}/selection`, { startAt: (await slots(30))[0], inviteeTimezone: "UTC", durationMinutes: 30 }, 503)).json();
assert.deepEqual([refused.error.code, refused.error.details], ["payments_unavailable", ["stripe_deauthorized"]]);
const freeSlot = (await data(`/api/public/book/dial-host/intro/availability?week=${future}`)).slots[0].startAt;
await call("/api/public/book/dial-host/intro/selection", { startAt: freeSlot, inviteeTimezone: "UTC" }, 201);
checks.push("a foreign account's deauthorization is 401; the host's marks Stripe deauthorized and new paid selections fail closed with payments_unavailable/stripe_deauthorized while free events still book");

// Erasure removes every payer value; DATA-007 keeps only anonymous processor cleanup lookup references.
const before = JSON.stringify(await data("/__fixtures/payments/all-rows"));
for (const detail of ["4242", "Card Holder Name", "payer-card-holder@dial.test", "customer_details", "dial-never-stores"]) assert.ok(!before.includes(detail), `${detail} never reaches a product table`);
const preview = await data("/api/app/privacy/preview", { email: "payer@dial.test" });
await data("/api/app/privacy/erase", { email: "payer@dial.test", confirmation: preview.confirmation, expiresAt: preview.expiresAt });
const retained = await data("/__fixtures/payments/all-rows"), {anonymized_audit:audit,processor_erasure_requests:cleanup,...tables}=retained;
for(const detail of ["payer@dial.test","Avery Payer"])assert.ok(!JSON.stringify(retained).includes(detail),"erased payer values are gone from every table, including anonymous audit and cleanup records");
for(const [table,records] of Object.entries(tables))for(const ref of [session.id,paidSession.payment_intent])assert.ok(!JSON.stringify(records).includes(ref),`${table}: processor references survive only in anonymous audit or cleanup records`);
assert.deepEqual(cleanup.filter(row=>row.processor_ref===session.id).map(row=>[row.kind,row.state,row.reason,row.requested]),[["stripe_checkout_email","pending","checkout_customer_email_not_editable_no_erasure_api",0]],"the immutable Checkout lookup is explicit and no unmade erasure call is claimed");
assert.deepEqual(audit.filter(row=>row.entity_kind==="payment").map(row=>[row.action,row.amount_cents,row.processor_ref]),[["payment",9000,paidSession.payment_intent]],"the payment amount and reference survive in the anonymized audit");
checks.push("erasure removes every payer value from every table; only anonymous audit and processor cleanup lookup references survive, with immutable Checkout email explicitly pending and no invented request");

await writeFile(evidencePath("payment-wire.json"), JSON.stringify({ title: "PAY-001 a paid booking confirms only after Stripe's signed event", checks, scope: "Native local D1 and production services with Stripe API, Connect OAuth and signed webhooks synthetic at the HTTP edge" }, null, 2));
console.log("PAY-001 paid booking journey passed.");
