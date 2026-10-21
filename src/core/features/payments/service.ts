import { deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { nowIso } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { EventTypeRecord } from "../event-types";
import type { BookingClaim } from "../bookings";
import { stripeConfiguration } from "./config";
import { StripeConnection } from "./connection";
import { eventPrice, priceForDuration, validatePrice, type EventPriceInput } from "./pricing";
import type { PaymentHold, PaymentsRepository } from "./repository";
import { StripeApi, StripeApiError, type CheckoutSession } from "./stripe-api";
import { verifyStripeSignature } from "./webhook-signature";
import type { Admission } from "../../platform/public-admission";

/** The slot is held for the payment window; Stripe's own minimum session lifetime is 30 minutes, so Dial
 * expires the session itself when its window ends. */
export const paymentWindowMs = 10 * 60 * 1000;
const checkoutLifetimeSeconds = 31 * 60;
const returnLifetimeMs = 24 * 60 * 60 * 1000;

export type PaidConversion = (claim: BookingClaim, payment: { holdId: string; statements: D1PreparedStatement[] }) => Promise<"claimed" | "slot_taken" | "blocked">;
type StripeEvent = { id: string; type: string; account?: string; data: { object: Record<string, unknown> } };
export type WebhookResult = { kind: "unauthorized" | "processed" | "ignored" | "rejected" } | { kind: "limited"; retryAfterSeconds: number };

export class PaymentsService {
  readonly connection: StripeConnection;
  private convert?: PaidConversion;
  constructor(private readonly repository: PaymentsRepository, private readonly runtime: RuntimeEnvironment, private readonly transport: typeof fetch = fetch) {
    this.connection = new StripeConnection(repository, runtime, transport);
  }

  setConversion(convert: PaidConversion) { this.convert = convert; }

  setAch(enabled: boolean) { return this.repository.setAch(enabled); }

  async eventPrice(eventTypeId: string) { return eventPrice(await this.repository.prices(eventTypeId)); }

  async savePrice(event: EventTypeRecord, input: EventPriceInput) {
    if (!validatePrice(input, event.durationOptionsMinutes?.length ? event.durationOptionsMinutes : [event.durationMinutes])) return { kind: "invalid_price" as const };
    await this.repository.replacePrices(event.id, [...(input.amountCents === null ? [] : [{ durationMinutes: 0, amountCents: input.amountCents }]), ...input.durationPrices]);
    return { kind: "saved" as const, price: await this.eventPrice(event.id) };
  }

  /** Undefined is a free booking. A paid event without a working connection fails closed with a named reason. */
  async quote(eventTypeId: string, durationMinutes: number) {
    const amountCents = priceForDuration(await this.eventPrice(eventTypeId), durationMinutes);
    if (amountCents === undefined) return undefined;
    const connection = await this.repository.connection();
    if (!stripeConfiguration(this.runtime)) return { kind: "unavailable" as const, amountCents, reason: "payments_not_configured" };
    if (connection?.status !== "connected" || !connection.accountId) return { kind: "unavailable" as const, amountCents, reason: connection?.status === "deauthorized" ? "stripe_deauthorized" : "stripe_not_connected" };
    return { kind: "available" as const, amountCents, accountId: connection.accountId, achEnabled: connection.achEnabled };
  }

  /** The payment-return capability (AUTH-007): derived from the selection nonce's 256 random bits, bound to one
   * hold, read-only and expiring a day after the hold. The paid booking's manage token derives from it, so the
   * return page can open the receipt once Stripe's signed event has confirmed the booking. */
  returnToken(nonce: string) { return deriveOpaqueToken(nonce, this.runtime.SESSION_SECRET, "payment-return.v1"); }
  manageToken(returnToken: string) { return deriveOpaqueToken(returnToken, this.runtime.SESSION_SECRET, "booking-manage.v1"); }
  hashReturnToken(token: string) { return hashToken(token, this.runtime.SESSION_SECRET); }
  holdTiming(now = Date.now()) { return { expiresAt: new Date(now + paymentWindowMs).toISOString(), returnExpiresAt: new Date(now + returnLifetimeMs).toISOString() }; }

  holdForNonce(nonceId: string) { return this.repository.holdByNonce(nonceId); }

  async openCheckout(input: { holdId: string; accountId: string; amountCents: number; eventTitle: string; durationMinutes: number; returnUrl: string; customerEmail: string; achEnabled: boolean }) {
    const params: Record<string, string> = {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": `${input.eventTitle} (${input.durationMinutes} minutes)`.slice(0, 250),
      // Stripe manages Checkout's methods (cards, Apple Pay, Google Pay, Link) from the account's Dashboard and
      // refuses payment_method_types; ACH Direct Debit is excluded unless the host enabled it in Dial.
      ...(input.achEnabled ? {} : { "excluded_payment_method_types[0]": "us_bank_account" }),
      success_url: `${input.returnUrl}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.returnUrl}&canceled=1`,
      expires_at: String(Math.floor(Date.now() / 1000) + checkoutLifetimeSeconds),
      client_reference_id: input.holdId,
      customer_email: input.customerEmail,
      "metadata[dial_hold_id]": input.holdId,
      "payment_intent_data[metadata][dial_hold_id]": input.holdId,
    };
    return this.api().createCheckoutSession(input.accountId, params, `dial-hold-${input.holdId}`);
  }

  attachCheckout(holdId: string, session: CheckoutSession, claim: BookingClaim) {
    if (!session.url) throw new StripeApiError(502, "checkout_url_missing");
    return this.repository.attachCheckout(holdId, session.id, session.url, JSON.stringify(claim));
  }

  releaseHold(holdId: string, reason: string) { return this.repository.endHold(holdId, "released", reason); }

  async bookingPayment(bookingId: string) { return this.repository.bookingPayment(bookingId); }

  /** The return page reads state only. Neither its query nor Stripe's session ID can confirm a booking. */
  async returnStatus(token: string) {
    const hold = await this.repository.holdByReturnToken(await this.hashReturnToken(token));
    if (!hold) return { kind: "not_found" as const };
    if (hold.returnExpiresAt <= nowIso()) return { kind: "expired" as const };
    const manageUrl = hold.state === "confirmed" ? new URL(`/manage/${await this.manageToken(token)}`, this.runtime.APP_URL).toString() : undefined;
    return { kind: "found" as const, status: { state: hold.state, amountCents: hold.amountCents, currency: hold.currency, startAt: hold.startAt, endAt: hold.endAt, expiresAt: hold.expiresAt, reference: hold.checkoutSessionId, checkoutUrl: hold.state === "held" ? hold.checkoutUrl : null, ...(manageUrl ? { manageUrl } : {}), ...(hold.endedReason ? { reason: hold.endedReason } : {}) } };
  }

  /** AUTH-005: an unsigned, mis-signed or stale event, or one whose connected account is not the hold's,
   * returns 401 and changes nothing. Every accepted event is idempotent through the hold's state. */
  async receiveWebhook(payload: string, signature: string | null, admit: () => Promise<Admission>): Promise<WebhookResult> {
    const config = stripeConfiguration(this.runtime);
    if (!config || !await verifyStripeSignature(payload, signature, config.webhookSecret)) return { kind: "unauthorized" };
    const admission = await admit();
    if (admission.kind === "limited") return admission;
    const event = parseEvent(payload);
    if (!event) return { kind: "rejected" };
    if (event.type === "account.application.deauthorized") {
      const connection = await this.repository.connection();
      if (!event.account || connection?.accountId !== event.account) return { kind: "unauthorized" };
      await this.repository.markDeauthorized(event.account);
      return { kind: "processed" };
    }
    const object = event.data.object;
    const holdId = typeof (object.metadata as Record<string, unknown> | undefined)?.dial_hold_id === "string" ? (object.metadata as Record<string, string>).dial_hold_id : undefined;
    const hold = event.type.startsWith("checkout.session.") && typeof object.id === "string" ? await this.repository.holdBySession(object.id) : holdId ? await this.repository.hold(holdId) : undefined;
    if (!hold) return { kind: "ignored" };
    if (event.account !== hold.accountId) return { kind: "unauthorized" };
    switch (event.type) {
      case "checkout.session.completed":
        if (object.payment_status === "paid") return this.confirm(hold, object, typeof object.payment_intent === "string" ? object.payment_intent : null);
        if (object.payment_status === "unpaid") { await this.repository.markProcessing(hold.id); return { kind: "processed" }; }
        return { kind: "rejected" };
      case "checkout.session.async_payment_succeeded":
        return this.confirm(hold, object, typeof object.payment_intent === "string" ? object.payment_intent : null);
      case "payment_intent.succeeded":
        return this.confirm(hold, { amount_total: object.amount_received, currency: object.currency }, typeof object.id === "string" ? object.id : null);
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
      case "payment_intent.payment_failed":
        await this.repository.endHold(hold.id, "released", event.type === "checkout.session.expired" ? "checkout_expired" : "payment_failed");
        return { kind: "processed" };
      default:
        return { kind: "ignored" };
    }
  }

  /** Release holds whose window ended: Dial expires the Checkout Session first, so a released slot can never be paid. */
  async sweepExpiredHolds(now = nowIso()) {
    for (const hold of await this.repository.dueHolds(now)) {
      if (!hold.checkoutSessionId) { await this.repository.endHold(hold.id, "released", "payment_window_expired"); continue; }
      try {
        await this.api().expireCheckoutSession(hold.accountId, hold.checkoutSessionId);
        await this.repository.endHold(hold.id, "released", "payment_window_expired");
      } catch (error) {
        if (!(error instanceof StripeApiError) || error.status !== 400) throw error;
        // Only an open session can be expired: the payer finished first, so read Stripe's outcome.
        const session = await this.api().getCheckoutSession(hold.accountId, hold.checkoutSessionId);
        if (session.status === "complete" && session.payment_status === "paid") await this.confirm(hold, session as unknown as Record<string, unknown>, session.payment_intent);
        else if (session.status === "complete") await this.repository.markProcessing(hold.id);
        else if (session.status === "expired") await this.repository.endHold(hold.id, "released", "checkout_expired");
      }
    }
  }

  private async confirm(hold: PaymentHold, paid: Record<string, unknown>, paymentIntentId: string | null): Promise<WebhookResult> {
    if (hold.state === "confirmed") return { kind: "processed" };
    if (!["held", "processing"].includes(hold.state) || !hold.claimJson || !hold.checkoutSessionId) return { kind: "processed" };
    // Dial confirms only the amount the invitee was shown, in USD.
    if (paid.amount_total !== hold.amountCents || paid.currency !== "usd") return { kind: "rejected" };
    if (!this.convert) throw new Error("Paid booking conversion is not configured");
    const claim = JSON.parse(hold.claimJson) as BookingClaim, now = nowIso();
    const outcome = await this.convert({ ...claim, now }, { holdId: hold.id, statements: [
      this.repository.bookingPaymentStatement({ bookingId: claim.bookingId, accountId: hold.accountId, amountCents: hold.amountCents, checkoutSessionId: hold.checkoutSessionId, paymentIntentId, paidAt: now }),
      this.repository.confirmHoldStatement(hold.id, claim.bookingId, now),
    ] });
    if (outcome !== "claimed") {
      const current = await this.repository.hold(hold.id);
      // A concurrent duplicate already confirmed it; otherwise the paid slot can no longer be booked.
      if (current?.state !== "confirmed") await this.repository.endHold(hold.id, "unbookable", outcome === "blocked" ? "invitee_blocked" : "slot_unavailable");
    }
    return { kind: "processed" };
  }

  private api() {
    const config = stripeConfiguration(this.runtime);
    if (!config) throw new Error("Missing Stripe configuration: STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, STRIPE_WEBHOOK_SECRET");
    return new StripeApi(config.secretKey, this.transport);
  }
}

function parseEvent(payload: string): StripeEvent | undefined {
  try {
    const value = JSON.parse(payload) as Partial<StripeEvent>;
    return typeof value.id === "string" && typeof value.type === "string" && value.data && typeof value.data.object === "object" && value.data.object !== null
      ? { id: value.id, type: value.type, ...(typeof value.account === "string" ? { account: value.account } : {}), data: { object: value.data.object as Record<string, unknown> } } : undefined;
  } catch { return undefined; }
}
