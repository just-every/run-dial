import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { admissionResponse } from "../../platform/public-admission";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { stripeCallbackPath, stripeWebhookPath } from "./config";
import { eventPriceInputSchema } from "./pricing";
import { paymentTermsInputSchema, termsRefusalMessages } from "./terms";
import { billingAddressSchema } from "./tax";
import type { MoneyRefusal } from "./money-service";

const callbackSchema = z.object({ state: z.string().min(1).max(4_096).optional(), code: z.string().min(1).max(4_096).optional(), error: z.string().max(200).optional() });
const tokenSchema = z.object({ token: z.string().min(1).max(512) });
const eventSchema = z.object({ id: z.string().min(1).max(64) });
const pageSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80), slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const bookingSchema = z.object({ id: z.string().length(26) });
const refundSchema = z.object({ amountCents: z.number().int().min(1).max(99_999_999), reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().uuid() }).strict();
const moneyRefusalMessages: Record<MoneyRefusal, string> = {
  payments_not_configured: "Stripe is not configured for this deployment, so Dial cannot move money.",
  stripe_not_connected: "Connect Stripe before refunding or charging fees.",
  stripe_deauthorized: "Stripe reported that Dial's access was revoked. Reconnect Stripe before refunding or charging fees.",
};

export const paymentRoutes = new Hono<AppEnvironment>()
  .get("/api/app/payments/stripe", async context => context.json(await context.get("services").payments.connection.status()))
  .get("/api/app/payments/stripe/oauth/start", async context => {
    const redirect = await context.get("services").payments.connection.begin(context.get("session"));
    return redirect ? context.redirect(redirect, 302) : apiError(context, 503, "payments_not_configured", "Stripe is not configured for this deployment.");
  })
  .delete("/api/app/payments/stripe", async context => context.json(await context.get("services").payments.connection.disconnect()))
  .put("/api/app/payments/stripe/ach", validate("json", z.object({ enabled: z.boolean() }).strict()), async context => {
    if (!await context.get("services").payments.setAch(context.req.valid("json").enabled)) return apiError(context, 409, "stripe_not_connected", "Connect Stripe before choosing payment methods.");
    return context.json(await context.get("services").payments.connection.status());
  })
  .get("/api/app/event-types/:id/price", validate("param", eventSchema), async context => {
    const event = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
    return event ? context.json(await context.get("services").payments.eventPrice(event.id)) : apiError(context, 404, "event_type_not_found", "Event type not found.");
  })
  .put("/api/app/event-types/:id/price", validate("param", eventSchema), validate("json", eventPriceInputSchema), async context => {
    const event = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
    if (!event) return apiError(context, 404, "event_type_not_found", "Event type not found.");
    const priceInput=context.req.valid("json");
    if((priceInput.amountCents!==null||priceInput.durationPrices.length>0)&&(await context.get("services").bookings.approvalSettings(event.id))?.required && ((await context.get("services").payments.eventTerms(event.id)).lateCancelFeeCents>0 || (await context.get("services").payments.eventTerms(event.id)).noShowFeeCents>0))return apiError(context,409,"approval_price_and_saved_card_conflict","Priced approval cannot also require a saved card for fees.");
    const result = await context.get("services").payments.savePrice(event, context.req.valid("json"));
    if (result.kind === "deposit_conflict") return apiError(context, 409, "deposit_conflict", "The saved deposit must stay below every price. Change the deposit first.", ["deposit"]);
    return result.kind === "saved" ? context.json(result.price) : apiError(context, 400, "invalid_price", "Price each offered duration at least $0.50, or set one event price.", ["durationPrices"]);
  })
  // PAY-003: the event type's deposit, balance due time and cancellation policy with its fees.
  .get("/api/app/event-types/:id/payment-terms", validate("param", eventSchema), async context => {
    const event = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
    return event ? context.json(await context.get("services").payments.eventTerms(event.id)) : apiError(context, 404, "event_type_not_found", "Event type not found.");
  })
  .put("/api/app/event-types/:id/payment-terms", validate("param", eventSchema), validate("json", paymentTermsInputSchema), async context => {
    const event = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
    if (!event) return apiError(context, 404, "event_type_not_found", "Event type not found.");
    const termsInput=context.req.valid("json");
    if((termsInput.lateCancelFeeCents>0||termsInput.noShowFeeCents>0)&&(await context.get("services").bookings.approvalSettings(event.id))?.required && ((await context.get("services").payments.eventPrice(event.id)).amountCents!==null || (await context.get("services").payments.eventPrice(event.id)).durationPrices.length>0))return apiError(context,409,"approval_price_and_saved_card_conflict","Priced approval cannot also require a saved card for fees.");
    const result = await context.get("services").payments.saveTerms(event, context.req.valid("json"));
    return result.kind === "saved" ? context.json(result.terms) : apiError(context, 400, result.refusal, termsRefusalMessages[result.refusal]);
  })
  // PAY-005: Stripe Tax on or off, and the business name receipts and invoices carry.
  .get("/api/app/payments/settings", async context => context.json(await context.get("services").payments.settings()))
  .put("/api/app/payments/settings", validate("json", z.object({ taxEnabled: z.boolean(), businessName: z.string().trim().max(120).nullable() }).strict()), async context => {
    const input = context.req.valid("json");
    await context.get("services").payments.saveSettings({ taxEnabled: input.taxEnabled, businessName: input.businessName || null });
    return context.json(await context.get("services").payments.settings());
  })
  .post("/api/app/bookings/:id/invoice", validate("param", bookingSchema), validate("json", z.object({ billingAddress: billingAddressSchema.optional() }).strict()), async context => {
    const { id } = context.req.valid("param");
    const result = await context.get("services").payments.invoices.issue(id, context.get("session").id, context.req.valid("json").billingAddress);
    if (result.kind === "issued") return context.json({ invoice: result.invoice, money: (await context.get("services").bookings.getForOperator(id))?.money ?? null });
    if (result.kind === "not_found") return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    if (result.kind === "refused") return apiError(context, 409, "payments_unavailable", moneyRefusalMessages[result.reason], [result.reason]);
    if (result.kind === "address_required") return apiError(context, 400, "billing_address_required", "Enter the invitee's billing address: Stripe Tax calculates the invoice's sales tax from it.", ["billingAddress"]);
    if (result.kind === "failed") return apiError(context, 503, "invoice_failed", "Stripe did not issue the invoice. Try again.", [result.reason]);
    return apiError(context, 409, "invoice_not_available", result.reason === "paid_upfront" ? "This booking was paid when it was booked." : result.reason === "booking_cancelled" ? "A cancelled booking cannot be invoiced." : "This booking's event type and duration have no price.", [result.reason]);
  })
  .get("/api/app/bookings/:id/money", validate("param", bookingSchema), async context => {
    const booking = await context.get("services").bookings.getForOperator(context.req.valid("param").id);
    return booking ? context.json({ money: booking.money ?? null, invoiceOffer: await context.get("services").payments.invoices.offer(booking.id) ?? null }) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  })
  .post("/api/app/bookings/:id/refunds", validate("param", bookingSchema), validate("json", refundSchema), async context => {
    const { id } = context.req.valid("param");
    const result = await context.get("services").payments.money.refund(id, context.get("session").id, context.req.valid("json"));
    if (result.kind === "not_found") return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    if (result.kind === "refused") return apiError(context, 409, "payments_unavailable", moneyRefusalMessages[result.reason], [result.reason]);
    if (result.kind === "exceeds_refundable") return apiError(context, 400, "refund_exceeds_paid", `At most ${(result.refundableCents / 100).toFixed(2)} USD can still be refunded.`, ["amountCents"]);
    if (result.kind === "key_reused") return apiError(context, 409, "idempotency_key_reused", "Start a new refund.");
    return context.json({ money: (await context.get("services").bookings.getForOperator(id))?.money ?? null });
  })
  .post("/api/app/bookings/:id/no-show-fee", validate("param", bookingSchema), async context => {
    const { id } = context.req.valid("param");
    const result = await context.get("services").payments.money.chargeNoShowFee(id, context.get("session").id);
    if (result.kind === "not_found") return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    if (result.kind === "refused") return apiError(context, 409, "payments_unavailable", moneyRefusalMessages[result.reason], [result.reason]);
    if (result.kind === "not_no_show") return apiError(context, 409, "not_marked_no_show", "Mark the booking as a no-show before charging the no-show fee.");
    if (result.kind === "no_consented_fee") return apiError(context, 409, "no_consented_fee", "This booking has no no-show fee the invitee agreed to on a saved card.");
    return context.json({ money: (await context.get("services").bookings.getForOperator(id))?.money ?? null });
  })
  .get(stripeCallbackPath, validate("query", callbackSchema), async context => {
    const query = context.req.valid("query");
    const result = await context.get("services").payments.connection.complete({ state: query.state, code: query.code, session: await context.get("services").operators.authenticate(context.req.raw) });
    if (result.kind === "invalid_state") return apiError(context, 400, "invalid_stripe_oauth_state", "The Stripe connection could not be verified.");
    if (result.kind === "provider_failure") return apiError(context, 503, "stripe_oauth_failed", "Stripe did not accept this connection.");
    return context.redirect(await context.get("services").hostSetup.completion() ? "/app/settings?stripe=connected" : "/setup/settings?stripe=connected", 302);
  })
  .post(stripeWebhookPath, async context => {
    const result = await context.get("services").payments.receiveWebhook(await context.req.text(), context.req.header("stripe-signature") ?? null, () => context.get("admitProvider")("stripe"));
    if (result.kind === "limited") return admissionResponse(result)!;
    if (result.kind === "unauthorized") return apiError(context, 401, "invalid_provider_callback", "Provider callback authentication failed.");
    if (result.kind === "rejected") return apiError(context, 400, "invalid_provider_event", "The provider event does not match this payment.");
    return context.json({ received: true });
  })
  .get("/api/public/payments/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").payments.returnStatus(context.req.valid("param").token);
    if (result.kind === "found") return context.json(result.status);
    return result.kind === "expired" ? apiError(context, 410, "payment_return_expired", "This payment link has expired.") : apiError(context, 404, "payment_return_not_found", "This payment link is not valid.");
  })
  // PAY-003's balance link: its own capability, bound to one booking and the balance action.
  .get("/api/public/payments/balance/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").payments.money.balanceStatus(context.req.valid("param").token);
    return result.kind === "found" ? context.json(result.status) : apiError(context, 404, "balance_link_not_found", "This payment link is not valid.");
  })
  .post("/api/public/payments/balance/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").payments.money.openBalanceCheckout(context.req.valid("param").token);
    if (result.kind === "checkout") return context.json({ checkoutUrl: result.checkoutUrl });
    if (result.kind === "not_found") return apiError(context, 404, "balance_link_not_found", "This payment link is not valid.");
    if (result.kind === "refused") return apiError(context, 503, "payments_unavailable", "Payments for this booking are unavailable right now. Contact the host.", [result.reason]);
    return apiError(context, result.state === "paid" ? 409 : 410, result.state === "paid" ? "balance_paid" : "balance_link_closed", result.state === "paid" ? "The balance is already paid." : "This booking no longer takes a balance payment.");
  })
  .get("/manage/balance/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").payments.money.balanceStatus(context.req.valid("param").token);
    return context.get("services").spaSurface.serve(context.req.raw, result.kind === "found" ? 200 : 404, { blockFraming: true });
  })
  .get("/book/:handle/:slug/paid", validate("param", pageSchema), validate("query", z.object({ return: z.string().max(512).optional() }).passthrough()), async context => {
    const token = context.req.valid("query").return;
    const result = token ? await context.get("services").payments.returnStatus(token) : { kind: "not_found" as const };
    return context.get("services").spaSurface.serve(context.req.raw, result.kind === "found" ? 200 : result.kind === "expired" ? 410 : 404, { blockFraming: true });
  });
