import { Accounting } from "./accounting";
import { Reconciliation } from "./reconciliation";
import { deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { nowIso } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { EventTypeRecord } from "../event-types";
import type { BookingClaim } from "../bookings";
import { stripeConfiguration } from "./config";
import { StripeConnection } from "./connection";
import { checkoutParams } from "./checkout-params";
import { eventPrice, priceForDuration, validatePrice, type EventPriceInput } from "./pricing";
import { MoneyRepository } from "./money-repository";
import { MoneyService } from "./money-service";
import { MovementsRepository } from "./movements-repository";
import { InvoiceService } from "./invoices";
import { PaymentsRepository, type PaymentHold } from "./repository";
import { StripeApi, StripeApiError, type CheckoutSession } from "./stripe-api";
import { cardRequired, termsFromRow, termsSnapshot, validateTerms, type PaymentTermsInput, type TermsSnapshot } from "./terms";
import { dueNowTaxCents } from "../../shared/payment-terms";
import { calculateTax, type BillingAddress } from "./tax";
import { receiptOperators, receiptStatements } from "./receipts";
import type { PaymentSettings } from "./money-repository";
import { verifyStripeSignature } from "./webhook-signature";
import type { Admission } from "../../platform/public-admission";
import type { ProcessorRequestsRepository } from "../erasure";
import { ProcessorErasure } from "./processor-erasure";
import { erasePendingPayments } from "./erasure";
import type { ApprovalPayment, StripeEvent } from "./approval-state";

/** The slot is held for the payment window; Stripe's own minimum session lifetime is 30 minutes, so Dial
 * expires the session itself when its window ends. */
export const paymentWindowMs = 10 * 60 * 1000;
const checkoutLifetimeSeconds = 31 * 60;
const returnLifetimeMs = 24 * 60 * 60 * 1000;

export type PaidConversion = (claim: BookingClaim, payment: { holdId: string; statements: D1PreparedStatement[] }, approval?: {id:string;operatorId:string}) => Promise<"claimed" | "slot_taken" | "blocked">;
/** What a booking costs now: a payment (the full price or a deposit) or, for a free event with stated fees, a
 * setup that only saves the consented card. */
export type Quote = { kind: "available"; mode: "payment" | "setup"; amountCents: number; snapshot: TermsSnapshot; saveCard: boolean; taxRequired: boolean; accountId: string; achEnabled: boolean };
type ApprovalLifecycle = {receive(hold:PaymentHold,event:StripeEvent):Promise<WebhookResult>;expire(hold:PaymentHold):Promise<void>;resume(hold:PaymentHold):Promise<PaymentHold|undefined>};
export type WebhookResult = { kind: "unauthorized" | "processed" | "ignored" | "rejected" } | { kind: "limited"; retryAfterSeconds: number };

export class PaymentsService {
  readonly accounting: Accounting;
  readonly reconciliation: Reconciliation;
  readonly processorErasure: ProcessorErasure;
  readonly connection: StripeConnection;
  readonly money: MoneyService;
  readonly invoices: InvoiceService;
  private readonly repository: PaymentsRepository;
  private readonly terms: MoneyRepository;
  private readonly db: D1Database;
  private convert?: PaidConversion;
  private approvalLifecycle?: ApprovalLifecycle;
  constructor(db: D1Database, private readonly runtime: RuntimeEnvironment, processorRequests:ProcessorRequestsRepository, private readonly transport: typeof fetch = fetch) {
    this.db = db;
    this.reconciliation = new Reconciliation(db, stripeConfiguration(runtime) ? new StripeApi(stripeConfiguration(runtime)!.secretKey,transport) : undefined);
    this.accounting = new Accounting(db, runtime, transport);
    this.repository = new PaymentsRepository(db);
    this.terms = new MoneyRepository(db);
    this.connection = new StripeConnection(this.repository, runtime, transport);
    const movements = new MovementsRepository(db);
    this.money = new MoneyService(db, this.repository, this.terms, movements, runtime, transport);
    this.processorErasure = new ProcessorErasure(db, () => this.money.live(),processorRequests);
    this.invoices = new InvoiceService(db, this.repository, this.terms, movements, this.money);
  }

  setConversion(convert: PaidConversion) { this.convert = convert; }
  setApprovalLifecycle(lifecycle:ApprovalLifecycle) { this.approvalLifecycle=lifecycle; }
  approvalProcessor() { return this.api(); }
  async resumeApprovalCheckout(hold:PaymentHold) { if(!this.approvalLifecycle)throw new Error("Approval payment lifecycle is not configured"); return this.approvalLifecycle.resume(hold); }

  setAch(enabled: boolean) { return this.repository.setAch(enabled); }

  async eventPrice(eventTypeId: string) { return eventPrice(await this.repository.prices(eventTypeId)); }

  async savePrice(event: EventTypeRecord, input: EventPriceInput) {
    const durations = offeredDurations(event);
    if (!validatePrice(input, durations)) return { kind: "invalid_price" as const };
    const next = eventPrice([...(input.amountCents === null ? [] : [{ durationMinutes: 0, amountCents: input.amountCents }]), ...input.durationPrices]);
    // A price change may not leave the saved deposit at or above a price, or without one.
    const current = await this.eventTerms(event.id);
    if (current.deposit.kind !== "none" && validateTerms(current, next, durations, null)?.startsWith("deposit")) return { kind: "deposit_conflict" as const };
    await this.repository.replacePrices(event.id, [...(input.amountCents === null ? [] : [{ durationMinutes: 0, amountCents: input.amountCents }]), ...input.durationPrices]);
    return { kind: "saved" as const, price: await this.eventPrice(event.id) };
  }

  async eventTerms(eventTypeId: string) { return termsFromRow(await this.terms.eventTerms(eventTypeId)); }

  /** PAY-005: Stripe Tax on or off, and the business name receipts and invoices carry. */
  async settings() {
    const settings = await this.terms.settings();
    return { taxEnabled: settings.taxEnabled, businessName: settings.businessName, effectiveBusinessName: settings.businessName ?? settings.hostName ?? "Dial" };
  }
  saveSettings(settings: PaymentSettings) { return this.terms.saveSettings(settings); }

  /** The sales tax Stripe Tax calculates on a booking's whole price at the invitee's address. */
  async taxFor(quote: Quote, address: BillingAddress, reference: string) {
    const figures = await calculateTax(this.api(), quote.accountId, { amountCents: quote.snapshot.priceCents, reference, address });
    const snapshot = { ...quote.snapshot, taxCents: figures.taxCents, taxSummary: figures.summary };
    return { quote: { ...quote, snapshot, amountCents: snapshot.dueNowCents + dueNowTaxCents(snapshot) }, figures };
  }

  async saveTerms(event: EventTypeRecord, input: PaymentTermsInput) {
    const refusal = validateTerms(input, await this.eventPrice(event.id), offeredDurations(event), await this.terms.cancellationCutoffMinutes(event.id));
    if (refusal) return { kind: "invalid_terms" as const, refusal };
    await this.terms.saveEventTerms(event.id, input);
    return { kind: "saved" as const, terms: await this.eventTerms(event.id) };
  }

  /** BOOK-015's cut-off editor refuses a cut-off that would start inside the event's free cancellation window. */
  async cutoffConflicts(eventTypeId: string, cancellationCutoffMinutes: number | null) {
    const terms = await this.eventTerms(eventTypeId);
    return terms.freeWindowHours !== null && (cancellationCutoffMinutes ?? 0) > terms.freeWindowHours * 60;
  }

  /** Undefined is a free booking. A paid event without a working connection fails closed with a named reason. */
  async quote(eventTypeId: string, durationMinutes: number): Promise<Quote | { kind: "unavailable"; amountCents: number; reason: string } | undefined> {
    const [price, terms] = await Promise.all([this.eventPrice(eventTypeId), this.eventTerms(eventTypeId)]);
    const amountCents = priceForDuration(price, durationMinutes), saveCard = cardRequired(terms);
    if (amountCents === undefined && !saveCard) return undefined;
    const snapshot = termsSnapshot(terms, amountCents ?? 0);
    const connection = await this.repository.connection();
    if (!stripeConfiguration(this.runtime)) return { kind: "unavailable", amountCents: snapshot.dueNowCents, reason: "payments_not_configured" };
    if (connection?.status !== "connected" || !connection.accountId) return { kind: "unavailable", amountCents: snapshot.dueNowCents, reason: connection?.status === "deauthorized" ? "stripe_deauthorized" : "stripe_not_connected" };
    const taxRequired = snapshot.priceCents > 0 && (await this.terms.settings()).taxEnabled;
    return { kind: "available", mode: snapshot.dueNowCents > 0 ? "payment" : "setup", amountCents: snapshot.dueNowCents, snapshot, saveCard, taxRequired, accountId: connection.accountId, achEnabled: connection.achEnabled };
  }

  /** The payment-return capability (AUTH-007): derived from the selection nonce's 256 random bits, bound to one
   * hold, read-only and expiring a day after the hold. The paid booking's manage token derives from it, so the
   * return page can open the receipt once Stripe's signed event has confirmed the booking. */
  returnToken(nonce: string) { return deriveOpaqueToken(nonce, this.runtime.SESSION_SECRET, "payment-return.v1"); }
  manageToken(returnToken: string) { return deriveOpaqueToken(returnToken, this.runtime.SESSION_SECRET, "booking-manage.v1"); }
  hashReturnToken(token: string) { return hashToken(token, this.runtime.SESSION_SECRET); }
  holdTiming(now = Date.now()) { return { expiresAt: new Date(now + paymentWindowMs).toISOString(), returnExpiresAt: new Date(now + returnLifetimeMs).toISOString() }; }

  holdForNonce(nonceId: string) { return this.repository.holdByNonce(nonceId); }

  async openCheckout(input: { holdId: string; quote: Quote; eventTitle: string; durationMinutes: number; returnUrl: string; customerEmail: string; approval?:boolean;createdAt?:string }) {
    const params = checkoutParams({ holdId: input.holdId, mode: input.quote.mode, amountCents: input.quote.snapshot.dueNowCents, taxCents: dueNowTaxCents(input.quote.snapshot), taxSummary: input.quote.snapshot.taxSummary, deposit: input.quote.snapshot.depositCents > 0, saveCard: input.quote.saveCard,
      eventTitle: input.eventTitle, durationMinutes: input.durationMinutes, returnUrl: input.returnUrl, customerEmail: input.customerEmail, achEnabled: input.quote.achEnabled,
      approval:input.approval, expiresAt: Math.floor((input.createdAt ? Date.parse(input.createdAt) : Date.now()) / 1000) + checkoutLifetimeSeconds });
    return this.api().createCheckoutSession(input.quote.accountId, params, `dial-hold-${input.holdId}`);
  }

  attachCheckout(holdId: string, session: CheckoutSession, claim: BookingClaim) {
    if (!session.url) throw new StripeApiError(502, "checkout_url_missing");
    return this.repository.attachCheckout(holdId, session.id, session.url, JSON.stringify(claim));
  }

  releaseHold(holdId: string, reason: string) { return this.repository.endHold(holdId, "released", reason); }

  async bookingPayment(bookingId: string) { return this.repository.bookingPayment(bookingId); }

  async erasePendingHolds(email: string) {
    const outcomes = await erasePendingPayments(this.db, email, () => this.money.live(), (account, ref) => this.processorErasure.detach(email, account, ref));
    for (const outcome of outcomes) {
      if(outcome.customerId)await this.processorErasure.customer(email,outcome.accountId,outcome.customerId);
      if(outcome.voidedIntentId)await this.processorErasure.fact(email,"payment_authorization_void",outcome.accountId,outcome.voidedIntentId,outcome.authorizedCents??0);
      if(outcome.refundId)await this.processorErasure.fact(email,"payment_refund",outcome.accountId,outcome.refundId,outcome.amountCents);
    }
    return outcomes;
  }

  /** The return page reads state only. Neither its query nor Stripe's session ID can confirm a booking. */
  async returnStatus(token: string) {
    const hold = await this.repository.holdByReturnToken(await this.hashReturnToken(token));
    if (!hold) return { kind: "not_found" as const };
    if (hold.returnExpiresAt <= nowIso()) return { kind: "expired" as const };
    const manageUrl = hold.state === "confirmed" ? new URL(`/manage/${await this.manageToken(token)}`, this.runtime.APP_URL).toString() : undefined;
    const request = await this.repository.approvalForNonce(hold.nonceId), claim = hold.claimJson ? JSON.parse(hold.claimJson) as BookingClaim : undefined;
    const approval = claim?.money?.approval ?? (request?.claimJson ? (JSON.parse(request.claimJson) as BookingClaim).money?.approval : undefined);
    return { kind: "found" as const, status: { ...(approval || request ? {approvalRequired:true} : {}), ...(request && approval && hold.state!=="confirmed" ? {approvalUrl:approval.url} : {}), state: hold.state, mode: hold.kind, amountCents: hold.amountCents, currency: hold.currency, startAt: hold.startAt, endAt: hold.endAt, expiresAt: hold.expiresAt, reference: hold.checkoutSessionId, checkoutUrl: hold.state === "held" ? hold.checkoutUrl : null, ...(manageUrl ? { manageUrl } : {}), ...(hold.endedReason ? { reason: hold.endedReason } : {}) } };
  }

  /** AUTH-005: an unsigned, mis-signed or stale event, or one whose connected account is not the hold's,
   * returns 401 and changes nothing. Every accepted event is idempotent through the hold's or movement's state. */
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
    const reconciliation = await this.reconciliation.receive(event);
    if (reconciliation) return reconciliation;
    const object = event.data.object;
    const movementId = metadata(object, "dial_movement_id");
    if (movementId) {
      const movement = await this.money.movements.get(movementId);
      if (movement?.kind === "refund") return this.money.receiveRefundEvent(event, movement);
      return movement?.kind === "invoice" ? this.invoices.receiveInvoiceEvent(event, movement) : this.money.receiveBalanceEvent(event, movementId);
    }
    const holdId = metadata(object, "dial_hold_id");
    const hold = event.type.startsWith("checkout.session.") && typeof object.id === "string" ? await this.repository.holdBySession(object.id) ?? (holdId ? await this.repository.hold(holdId) : undefined) : holdId ? await this.repository.hold(holdId) : event.type.startsWith("refund.") && typeof object.payment_intent==="string" ? await this.repository.holdByApprovalIntent(object.payment_intent) : undefined;
    if (!hold) return { kind: "ignored" };
    if (event.account !== hold.accountId) return { kind: "unauthorized" };
    if ((hold.claimJson && (JSON.parse(hold.claimJson) as BookingClaim).money?.approval) || await this.repository.approvalForNonce(hold.nonceId)) {
      if(!this.approvalLifecycle)throw new Error("Approval payment lifecycle is not configured");
      return this.approvalLifecycle.receive(hold,event);
    }
    switch (event.type) {
      case "checkout.session.completed":
        if (hold.kind === "setup" || object.payment_status === "paid") return this.confirm(hold, object, typeof object.payment_intent === "string" ? object.payment_intent : null);
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
      if(hold.claimJson && (JSON.parse(hold.claimJson) as BookingClaim).money?.approval) { if(!this.approvalLifecycle)throw new Error("Approval payment lifecycle is not configured"); await this.approvalLifecycle.expire(hold);continue; }
      if (!hold.checkoutSessionId) { await this.repository.endHold(hold.id, "released", "payment_window_expired"); continue; }
      try {
        await this.api().expireCheckoutSession(hold.accountId, hold.checkoutSessionId);
        await this.repository.endHold(hold.id, "released", "payment_window_expired");
      } catch (error) {
        if (!(error instanceof StripeApiError) || error.status !== 400) throw error;
        // Only an open session can be expired: the payer finished first, so read Stripe's outcome.
        const session = await this.api().getCheckoutSession(hold.accountId, hold.checkoutSessionId);
        if (session.status === "complete" && (session.payment_status === "paid" || hold.kind === "setup")) await this.confirm(hold, session as unknown as Record<string, unknown>, session.payment_intent);
        else if (session.status === "complete") await this.repository.markProcessing(hold.id);
        else if (session.status === "expired") await this.repository.endHold(hold.id, "released", "checkout_expired");
      }
    }
  }

  async confirmApproval(hold:PaymentHold,payment:ApprovalPayment,approval:{id:string;operatorId:string}) {
    await this.confirm(hold,payment.mode==="setup" ? {mode:"setup",status:"complete",setup_intent:payment.setupIntentId,customer:payment.customerId} : {amount_total:payment.amountCents,currency:"usd"},payment.paymentIntentId,{...approval,payment});
    return (await this.repository.hold(hold.id))?.state==="confirmed";
  }
  private async confirm(hold: PaymentHold, paid: Record<string, unknown>, paymentIntentId: string | null, approval?:{id:string;operatorId:string;payment:ApprovalPayment}): Promise<WebhookResult> {
    if (hold.state === "confirmed") return { kind: "processed" };
    if (!["held", "processing"].includes(hold.state) || !hold.claimJson || !hold.checkoutSessionId) return { kind: "processed" };
    // Dial confirms only the amount the invitee was shown, in USD; a setup confirms only a completed card setup.
    const setup = hold.kind === "setup";
    if (setup ? paid.mode !== "setup" || paid.status !== "complete" || typeof paid.setup_intent !== "string" : paid.amount_total !== hold.amountCents || paid.currency !== "usd") return { kind: "rejected" };
    if (!this.convert) throw new Error("Paid booking conversion is not configured");
    const claim = JSON.parse(hold.claimJson) as BookingClaim, now = nowIso(), money = claim.money;
    const card = money?.consent ? approval ? {accountId:hold.accountId,customerId:approval.payment.customerId,paymentMethodId:approval.payment.paymentMethodId} : await this.savedCard(hold, paid, paymentIntentId) : undefined;
    const kind = money && money.snapshot.depositCents > 0 ? "deposit" as const : "payment" as const, taxCents = money ? dueNowTaxCents(money.snapshot) : 0;
    // PAY-005: the first payment's receipt is queued with the booking, keyed by its Stripe reference.
    const receipt = setup || approval ? [] : receiptStatements(this.db, { id: claim.bookingId, inviteeName: claim.invitee.name, inviteeEmail: claim.invitee.email, eventTitle: claim.event.title, startAt: claim.selection.startAt, hostTimezone: claim.hostTimezone, inviteeTimezone: claim.selection.inviteeTimezone, ...(money?.manageUrl ? { manageUrl: money.manageUrl } : {}) },
      { ref: hold.checkoutSessionId, kind, amountCents: hold.amountCents, taxCents, taxSummary: money?.snapshot.taxSummary ?? null, paidAt: now }, (await this.settings()).effectiveBusinessName, await receiptOperators(this.db));
    const outcome = await this.convert({ ...claim, now }, { holdId: hold.id, statements: [
      ...(setup ? [] : [this.repository.bookingPaymentStatement({ bookingId: claim.bookingId, accountId: hold.accountId, amountCents: hold.amountCents, checkoutSessionId: hold.checkoutSessionId, paymentIntentId, paidAt: now, kind, taxCents, taxSummary: money?.snapshot.taxSummary ?? null })]),
      ...(money ? this.terms.confirmationStatements(claim.bookingId, money, card, money.balanceSalt ? await this.money.balanceTokenHash(money.balanceSalt) : undefined, now) : []),
      this.repository.confirmHoldStatement(hold.id, claim.bookingId, now),
      ...receipt,
    ] },approval ? {id:approval.id,operatorId:approval.operatorId} : undefined);
    if (outcome !== "claimed") {
      const current = await this.repository.hold(hold.id);
      // A concurrent duplicate already confirmed it; otherwise the paid slot can no longer be booked.
      if (current?.state !== "confirmed" && !approval) await this.repository.endHold(hold.id, "unbookable", outcome === "blocked" ? "invitee_blocked" : "slot_unavailable");
    }
    return { kind: "processed" };
  }

  /** The saved card's references come from Stripe's own objects: the SetupIntent of a setup session, or the
   * PaymentIntent that kept the card during payment. Dial never reads card details. */
  private async savedCard(hold: PaymentHold, paid: Record<string, unknown>, paymentIntentId: string | null) {
    const api = this.api();
    const intent = hold.kind === "setup" ? await api.getSetupIntent(hold.accountId, paid.setup_intent as string) : paymentIntentId ? await api.getPaymentIntent(hold.accountId, paymentIntentId) : undefined;
    return { accountId: hold.accountId, customerId: intent?.customer ?? (typeof paid.customer === "string" ? paid.customer : null), paymentMethodId: intent?.payment_method ?? null };
  }

  private api() {
    const config = stripeConfiguration(this.runtime);
    if (!config) throw new Error("Missing Stripe configuration: STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, STRIPE_WEBHOOK_SECRET");
    return new StripeApi(config.secretKey, this.transport);
  }
}

function offeredDurations(event: EventTypeRecord) { return event.durationOptionsMinutes?.length ? event.durationOptionsMinutes : [event.durationMinutes]; }

function metadata(object: Record<string, unknown>, key: string) {
  const value = (object.metadata as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function parseEvent(payload: string): StripeEvent | undefined {
  try {
    const value = JSON.parse(payload) as Partial<StripeEvent>;
    return typeof value.id === "string" && typeof value.type === "string" && value.data && typeof value.data.object === "object" && value.data.object !== null
      ? { id: value.id, type: value.type, ...(Number.isInteger(value.created) ? {created:value.created} : {}), ...(typeof value.account === "string" ? { account: value.account } : {}), data: { object: value.data.object as Record<string, unknown> } } : undefined;
  } catch { return undefined; }
}
