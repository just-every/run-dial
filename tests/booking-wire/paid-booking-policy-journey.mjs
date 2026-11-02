import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { paymentFetch } from "./payment-request.mjs";
import { bookingMail, recipient } from "./mail-contracts.mjs";

// Exercise paid invitee changes through native HTTP; only provider transports are synthetic.
const origin = process.env.DIAL_REVIEW_ORIGIN;
const configuration = await readFile(new URL("./worker.wrangler.toml", import.meta.url), "utf8");
const webhookSecret = /^STRIPE_WEBHOOK_SECRET = "([^"]+)"$/m.exec(configuration)[1];
const email = number => `synthetic-dial-${number}${String.fromCharCode(64)}example.test`;
let cookie;
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST", anonymous = false, headers = {}) {
  const response = await paymentFetch(origin + path, {
    method,
    headers: { origin, "content-type": "application/json", ...(!anonymous && cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${method} ${path.replace(/\/manage\/[^/]+/u, "/manage/[redacted]")}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const rows = () => data("/__fixtures/payments/all-rows");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const webhook = payload => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  return call("/api/webhooks/stripe", payload, 200, "POST", true, { "stripe-signature": `t=${timestamp},v1=${signature}` });
};
const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Synthetic owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await data("/__fixtures/setup", {});
const authorize = new URL((await call("/api/app/payments/stripe/oauth/start", undefined, 302)).headers.get("location"));
await call(`/api/payments/stripe/oauth/callback?${new URLSearchParams({ code: "wire-stripe-consent", state: authorize.searchParams.get("state") })}`, undefined, 302);
const account = (await state()).payment_connections[0].account_id;
const event = await data("/api/app/event-types", {
  slug: "synthetic-dial-151", title: "Synthetic paid appointment", description: "An upfront paid appointment.",
  durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Meeting room", locationValue: "https://example.test/meeting",
  listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
  beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
  availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
}, 201);
await data(`/api/app/event-types/${event.id}/price`, { amountCents: 9000, durationPrices: [] }, 200, "PUT");
await data(`/api/app/event-types/${event.id}/booking-policy`, {
  lockedTimezone: null, rescheduleCutoffMinutes: 1440, cancellationCutoffMinutes: 1440, maxInviteeReschedules: null,
}, 200, "PUT");
await data(`/api/app/event-types/${event.id}/payment-terms`, {
  deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: 24, lateCancelFeeCents: 0, noShowFeeCents: 0,
}, 200, "PUT");
await data(`/api/app/event-types/${event.id}/publish`, {});
const base = `/api/public/book/dial-host/${event.slug}`;
// Select relative intervals with ample margin from the cut-off, independent of the UTC date or local midnight.
const now = Date.now(), week = new Date(now).toISOString().slice(0, 10);
const offers = (await data(`${base}/availability?week=${week}`, undefined, 200, "GET", true)).slots;
const between = (low, high) => offers.find(slot => { const hours = (Date.parse(slot.startAt) - now) / 3600000; return hours > low && hours < high; });
const near = between(23, 23.75), outside = between(26, 27), target = between(49, 50);
assert.ok(near && outside && target, "availability offers both sides of the cut-off and a later destination");
async function book(slot, number) {
  const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201, "POST", true);
  const step = await data(`${base}/confirm`, {
    nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: `synthetic-dial-${number}`, email: email(number), answers: {},
  }, 202, "POST", true);
  const returnToken = new URL(step.payment.returnUrl).searchParams.get("return");
  const sessionId = new URL(step.payment.checkoutUrl).pathname.split("/").at(-1);
  const held = await state();
  assert.equal(held.bookings.filter(row => row.invitee_email === email(number)).length, 0, "public confirm alone cannot confirm payment");
  assert.equal((await data(`/api/public/payments/${returnToken}`, undefined, 200, "GET", true)).state, "held");
  const paid = await data("/__fixtures/payments/pay", { sessionId });
  const completed = JSON.stringify({ id: `synthetic-dial-${number}-paid`, object: "event", type: "checkout.session.completed", account, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: paid } });
  await webhook(completed);
  const receipt = await data(`/api/public/payments/${returnToken}`, undefined, 200, "GET", true);
  assert.equal(receipt.state, "confirmed");
  const manage = `/api/public/manage/${new URL(receipt.manageUrl).pathname.split("/").at(-1)}`;
  const snapshot = await state();
  const bookings = snapshot.bookings.filter(row => row.invitee_email === email(number));
  assert.equal(bookings.length, 1);
  assert.deepEqual(snapshot.booking_payments.filter(row => row.booking_id === bookings[0].id).map(row => [row.kind, row.amount_cents, row.checkout_session_id, row.payment_intent_id]), [["payment", 9000, sessionId, paid.payment_intent]]);
  return { id: bookings[0].id, manage, completed, intent: paid.payment_intent };
}
const blocked = await book(near, 152);
const allowed = await book(outside, 153);
await deliver();
const initial = await state(), persisted = await rows();
const original = await data(blocked.manage, undefined, 200, "GET", true);
assert.equal(original.occurrence.startAt, near.startAt);
assert.equal(original.payment.paidCents, 9000);
assert.deepEqual([original.changePolicy.rescheduleReason, original.changePolicy.cancellationReason], ["reschedule_cutoff", "cancellation_cutoff"]);
const blockedBooking = initial.bookings.find(row => row.id === blocked.id);
assert.equal(blockedBooking.calendar_state, "succeeded");
assert.ok(blockedBooking.calendar_provider_event_id, "the refusal protects an actual destination event");
assert.ok(initial.wire_events.some(row => row.id === blockedBooking.calendar_provider_event_id));
assert.ok(initial.delivery_outbox.some(row => row.booking_id === blocked.id && row.kind === "reminder"), "the refusal protects queued reminders");
assert.equal(persisted.booking_manage_tokens.filter(row => row.booking_id === blocked.id).length, 1);
assert.equal(bookingMail(initial, blocked.id).filter(mail => /^(Confirmed:|New booking:)/u.test(mail.subject)).length, 2);

// Every blocked command is repeated, with the original capability and no operator session.
for (let attempt = 0; attempt < 2; attempt++) {
  for (const [suffix, body, reason] of [
    ["/reschedule/selection", { startAt: target.startAt, inviteeTimezone: "UTC" }, "reschedule_cutoff"],
    ["/reschedule", { nonce: "synthetic-dial-154", startAt: target.startAt, inviteeTimezone: "UTC" }, "reschedule_cutoff"],
    ["/cancel", { reason: "Synthetic change" }, "cancellation_cutoff"],
  ]) assert.equal((await data(blocked.manage + suffix, body, 409, "POST", true)).error.code, reason);
}
await deliver();
const after = await state(), afterRows = await rows();
for (const table of [
  "bookings", "booking_occurrences", "booking_history", "booking_answers", "booking_manage_tokens", "booking_nonces",
  "delivery_outbox", "delivery_attempts", "booking_payments", "booking_payment_terms", "booking_card_consents",
  "payment_holds", "payment_link_tokens", "payment_movements", "payment_processor_facts",
]) assert.deepEqual(afterRows[table], persisted[table], `refused paid changes preserve ${table}`);
for (const table of ["wire_events", "wire_stripe_sessions", "wire_stripe_objects"]) assert.deepEqual(after[table], initial[table], `refused paid changes preserve ${table}`);
// Independent calendar connection-health and watch maintenance are not booking effects.
const bookingCalls = snapshot => snapshot.wire_calls.filter(row => !/^https:\/\/www\.googleapis\.com\/calendar\/v3\/(?:users\/me\/calendarList(?:\/|\?|$)|freeBusy$|calendars\/[^/]+\/events\/watch$|channels\/stop$)/u.test(row.url));
assert.deepEqual(bookingCalls(after), bookingCalls(initial), "refused paid changes make no booking calendar, mail or processor call");
assert.deepEqual(await data(blocked.manage, undefined, 200, "GET", true), original, "original manage authority and receipt survive refusals");
console.log("PROBE BOOK-015 paid reschedule: original manage selection and commit at approximately 23 hours -> 409 reschedule_cutoff twice; booking, authority, reminders, calendar and money unchanged");
console.log("PROBE BOOK-015 paid cancellation: original manage cancel at approximately 23 hours -> 409 cancellation_cutoff twice; booking, authority, reminders, calendar and money unchanged");

// The equivalent paid booking outside the cut-off can move, preserving its payment and provider-event identity.
const control = initial.bookings.find(row => row.id === allowed.id);
const controlReceipt = await data(allowed.manage, undefined, 200, "GET", true);
assert.deepEqual([controlReceipt.changePolicy.rescheduleAllowed, controlReceipt.changePolicy.cancellationAllowed], [true, true]);
const selected = await data(`${allowed.manage}/reschedule/selection`, { startAt: target.startAt, inviteeTimezone: "UTC" }, 201, "POST", true);
const move = { nonce: selected.nonce, startAt: target.startAt, inviteeTimezone: "UTC" };
const moved = await data(`${allowed.manage}/reschedule`, move, 200, "POST", true);
await data(`${allowed.manage}/reschedule`, move, 200, "POST", true);
assert.equal(moved.occurrence.startAt, target.startAt);
assert.deepEqual(moved.payment, { ...controlReceipt.payment, freeWindowEndsAt: new Date(Date.parse(target.startAt) - 24 * 3600000).toISOString() }, "reschedule keeps all payment facts and moves the free window with the occurrence");
await deliver();
let snapshot = await state();
assert.equal(snapshot.bookings.find(row => row.id === allowed.id).calendar_provider_event_id, control.calendar_provider_event_id);
assert.equal(snapshot.booking_history.filter(row => row.booking_id === allowed.id && row.action === "rescheduled").length, 1);
assert.equal(snapshot.payment_movements.length, 0);
assert.ok(Date.now() < Date.parse(moved.payment.freeWindowEndsAt), "permitted cancellation is still inside its configured free window");
const cancelled = await data(`${allowed.manage}/cancel`, { reason: "Synthetic cancellation" }, 200, "POST", true);
assert.equal(cancelled.state, "cancelled");
await data(`${allowed.manage}/cancel`, { reason: "Synthetic cancellation" }, 200, "POST", true);
await webhook(allowed.completed);
await webhook(allowed.completed);
await deliver();
snapshot = await state();
assert.deepEqual(snapshot.payment_movements.filter(row => row.booking_id === allowed.id).map(row => [row.kind, row.status, row.amount_cents, row.actor_type]), [["refund", "succeeded", 9000, "policy"]]);
const refunds = snapshot.wire_calls.filter(row => new URL(row.url).pathname === "/v1/refunds");
assert.equal(refunds.length, 1, "cancel and capture replays produce one processor refund");
assert.deepEqual([JSON.parse(refunds[0].body).payment_intent, JSON.parse(refunds[0].body).amount], [allowed.intent, "9000"]);
assert.ok(JSON.parse(refunds[0].headers).idempotency, "the refund uses the existing money-movement idempotency key");
assert.equal(snapshot.booking_history.filter(row => row.booking_id === allowed.id && row.action === "cancelled").length, 1);
assert.equal(bookingMail(snapshot, allowed.id).filter(mail => /^Booking cancelled:/u.test(mail.subject) && recipient(mail).includes(email(153))).length, 1);
assert.equal((await data(allowed.manage, undefined, 200, "GET", true)).payment.refundedCents, 9000);
const finalRows = await rows();
for (const table of ["bookings", "booking_occurrences", "booking_history", "booking_manage_tokens", "delivery_outbox", "booking_payments", "payment_movements", "payment_processor_facts"]) {
  const ownRows = all => all[table].filter(row => row.booking_id === blocked.id || (table === "bookings" && row.id === blocked.id));
  assert.deepEqual(ownRows(finalRows), ownRows(persisted), `allowed control changes preserve the blocked booking's ${table}`);
}
assert.equal(snapshot.wire_events.find(row => row.id === blockedBooking.calendar_provider_event_id).payload, initial.wire_events.find(row => row.id === blockedBooking.calendar_provider_event_id).payload);
console.log("PROBE BOOK-015 paid control: original manage outside 24 hours -> reschedule succeeds; free-window cancellation refunds 9000 cents exactly once despite repeated cancellation and signed capture replay");
