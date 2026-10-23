import { Reconciliation, type ProcessorFact } from "./reconciliation";
import { deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { nowIso } from "../../shared/ids";
import { cancellationOutcome, type CancellationOutcome } from "../../shared/payment-terms";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { stripeConfiguration } from "./config";
import { allocateRefund, ledger, type Ledger } from "./ledger";
import type { CardConsent, MoneyRepository } from "./money-repository";
import type { Movement, MovementsRepository, NewMovement } from "./movements-repository";
import type { BookingPayment, PaymentsRepository } from "./repository";
import { StripeApi, StripeApiError } from "./stripe-api";
import type { TermsSnapshot } from "./terms";
import { balanceTaxCents } from "../../shared/payment-terms";
import { receiptAudience, receiptStatements, type ReceiptKind } from "./receipts";
import { hostRefund, type HostCancellation, type HostRefundOutcome } from "./host-cancellation";
import { voidAtStripe } from "./cancellation-voids";

export type MoneyRefusal = "payments_not_configured" | "stripe_not_connected" | "stripe_deauthorized";
export type BookingMoney = { reconciliation: ProcessorFact[]; payment?: BookingPayment; snapshot?: TermsSnapshot; consent?: CardConsent; movements: Movement[]; ledger: Ledger; balanceUrl?: string };
/** What a cancellation does to the money, and the movements that carry it out, committed with the cancellation. */
export type CancellationPlan = { outcome: CancellationOutcome | HostRefundOutcome; refundCents: number; voids: Array<"balance" | "invoice">; statements: D1PreparedStatement[] };
type Condition = { sql: string; params: unknown[] };
type Live = { accountId: string; api: StripeApi };
type BookingFacts = { id: string; state: string; startAt: string; endAt: string; eventTitle: string; durationMinutes: number; inviteeEmail: string; attendance: string | null };
const staleAfterMs = 2 * 60 * 1000;
const balanceCheckoutSeconds = 23 * 60 * 60;

/** PAY-003: every money movement after a booking's first payment. A movement is written pending before Stripe is
 * called, carries a client idempotency key that Stripe also receives, and settles once: a retry, a replayed event or
 * a repeated cancel repeats nothing, and a declined off-session charge is recorded as failed and never retried. */
export class MoneyService {
  constructor(private readonly db: D1Database, private readonly payments: PaymentsRepository, readonly money: MoneyRepository, readonly movements: MovementsRepository, private readonly runtime: RuntimeEnvironment, private readonly transport: typeof fetch) {}

  /** Refunds and fees need a configured, connected Stripe account; otherwise they are refused with a named reason. */
  async live(): Promise<Live | { refusal: MoneyRefusal }> {
    const config = stripeConfiguration(this.runtime);
    if (!config) return { refusal: "payments_not_configured" };
    const connection = await this.payments.connection();
    if (connection?.status !== "connected" || !connection.accountId) return { refusal: connection?.status === "deauthorized" ? "stripe_deauthorized" : "stripe_not_connected" };
    return { accountId: connection.accountId, api: new StripeApi(config.secretKey, this.transport) };
  }

  balanceToken(salt: string) { return deriveOpaqueToken(salt, this.runtime.SESSION_SECRET, "payment-balance.v1"); }
  async balanceTokenHash(salt: string) { return hashToken(await this.balanceToken(salt), this.runtime.SESSION_SECRET); }

  async bookingMoney(bookingId: string, payment?: BookingPayment): Promise<BookingMoney | undefined> {
    const [snapshot, consent, movements, salt, facts] = await Promise.all([this.money.snapshot(bookingId), this.money.consent(bookingId), this.movements.forBooking(bookingId), this.money.balanceLink(bookingId), this.facts(bookingId)]);
    if (!payment && !snapshot && !movements.length) return undefined;
    const reconciliation = await new Reconciliation(this.db).facts(bookingId);
    const summary = ledger(payment, snapshot, movements, facts?.state === "cancelled", reconciliation);
    const balanceUrl = salt && summary.balanceDueCents > 0 ? new URL(`/manage/balance/${await this.balanceToken(salt)}`, this.runtime.APP_URL).toString() : undefined;
    return { reconciliation, ...(payment ? { payment } : {}), ...(snapshot ? { snapshot } : {}), ...(consent ? { consent } : {}), movements, ledger: summary, ...(balanceUrl ? { balanceUrl } : {}) };
  }

  private async cancellationFacts(bookingId: string, now: string, condition: Condition) {
    const [payment, snapshot, consent, movements] = await Promise.all([this.payments.bookingPayment(bookingId), this.money.snapshot(bookingId), this.money.consent(bookingId), this.movements.forBooking(bookingId)]);
    const voids = [...new Set(movements.filter(movement => (movement.kind === "balance" || movement.kind === "invoice") && movement.status === "pending").map(movement => movement.kind as "balance" | "invoice"))];
    const accountId = payment?.accountId ?? consent?.accountId ?? movements.find(movement => movement.status === "succeeded")?.accountId;
    return { payment, snapshot, consent, movements, accountId, voids, voidStatements: voids.length ? [this.movements.voidOpenStatement(bookingId, now, condition)] : [] };
  }

  /** What an invitee's cancellation does to the money under the policy they were shown. The statements insert only
   * if `condition` holds, so they commit with the cancellation that won; any open balance or invoice is voided. */
  async inviteeCancellationPlan(bookingId: string, startAt: string, now: string, condition: Condition): Promise<CancellationPlan | undefined> {
    const { payment, snapshot, consent, movements, accountId, voids, voidStatements } = await this.cancellationFacts(bookingId, now, condition);
    if (!snapshot) return voids.length ? { outcome: { kind: "none", reason: "no_policy" }, refundCents: 0, voids, statements: voidStatements } : undefined;
    const outcome = cancellationOutcome(snapshot, startAt, now), summary = ledger(payment, snapshot, movements, false, await new Reconciliation(this.db).facts(bookingId));
    if (outcome.kind === "refund" && summary.refundableCents > 0 && accountId) {
      const parts = allocateRefund(summary.charges, summary.refundableCents) ?? [];
      return { outcome, refundCents: summary.refundableCents, voids, statements: [...voidStatements, ...parts.map(part => this.movements.insertStatement({ bookingId, kind: "refund", amountCents: part.amountCents, taxCents: part.taxCents, actorType: "policy", actorId: null, reason: "Cancelled inside the free cancellation window", accountId, sourceRef: part.ref, idempotencyKey: `policy-refund:${bookingId}:${part.ref}` }, now, condition))] };
    }
    if (outcome.kind === "late_fee" && consent?.paymentMethodId && consent.lateCancelFeeCents === outcome.feeCents) {
      return { outcome, refundCents: 0, voids, statements: [...voidStatements, this.movements.insertStatement({ bookingId, kind: "late_cancel_fee", amountCents: outcome.feeCents, actorType: "policy", actorId: null, reason: "Cancelled after the free cancellation window", accountId: consent.accountId, sourceRef: null, idempotencyKey: `policy-fee:${bookingId}` }, now, condition)] };
    }
    return { outcome: outcome.kind === "late_fee" ? { kind: "none", reason: "late_without_fee" } : outcome, refundCents: 0, voids, statements: voidStatements };
  }

  /** PAY-003 (D4): a host-side cancellation refunds everything captured, once, charges no fee and voids any open
   * balance or invoice; an operator may refund less, or nothing, with a reason. */
  async hostCancellationPlan(bookingId: string, now: string, by: HostCancellation, condition: Condition): Promise<CancellationPlan | { kind: "exceeds_refundable"; refundableCents: number } | undefined> {
    const { payment, snapshot, movements, accountId, voids, voidStatements } = await this.cancellationFacts(bookingId, now, condition);
    if (!payment && !snapshot && !movements.length) return undefined;
    const refund = hostRefund(bookingId, ledger(payment, snapshot, movements, false, await new Reconciliation(this.db).facts(bookingId)), accountId, by);
    if (refund.kind === "exceeds_refundable") return refund;
    return { outcome: refund.outcome, refundCents: refund.refundCents, voids, statements: [...voidStatements, ...refund.movements.map(movement => this.movements.insertStatement(movement, now, condition))] };
  }

  /** After a cancellation commits: its refunds and the voids of what Stripe could still collect run together. */
  async afterCancellation(bookingId: string) {
    const [pending, voids] = await Promise.all([this.movements.pendingFor(bookingId), this.movements.voidsPending(bookingId)]);
    if (!pending.length && !voids.length) return;
    const live = await this.live();
    await Promise.all([(async () => { for (const movement of pending) await this.execute(movement, live); })(), voidAtStripe(this.movements, voids, live)]);
  }

  /** D4: Stripe captured a balance or an invoice for a booking already cancelled, because it was paid before Dial's
   * void reached Stripe. The payment is recorded with its receipt and, in the same transaction, a full refund of it
   * that its key makes once-only; the refund then runs. */
  private async settleLatePayment(movement: Movement, ref: string) {
    const refund = this.movements.insertStatement({ bookingId: movement.bookingId, kind: "refund", amountCents: movement.amountCents, taxCents: movement.taxCents, actorType: "policy", actorId: null, reason: "Paid after the booking was cancelled", accountId: movement.accountId, sourceRef: ref, idempotencyKey: `late-payment-refund:${movement.id}` },
      nowIso(), { sql: "EXISTS (SELECT 1 FROM payment_movements WHERE id = ? AND status = 'succeeded' AND processor_ref = ?)", params: [movement.id, ref] });
    await this.db.batch([this.movements.succeedLateStatement(movement.id, ref), ...await this.receipt(movement, ref), refund]);
    await this.settle(movement.bookingId);
  }

  /** A signed balance or invoice payment settles its movement, or, for a cancelled booking, is refunded (D4). */
  async settlePayment(movement: Movement, ref: string) {
    if ((await this.facts(movement.bookingId))?.state === "cancelled") return this.settleLatePayment(movement, ref);
    await this.movements.succeed(movement.id, ref, await this.receipt(movement, ref));
  }

  /** Carry out a booking's pending refunds and fees. */
  async settle(bookingId: string) {
    const pending = await this.movements.pendingFor(bookingId);
    if (!pending.length) return;
    const live = await this.live();
    for (const movement of pending) await this.execute(movement, live);
  }

  /** Crash recovery: a movement whose call was cut off is re-sent with the same idempotency key, so Stripe answers
   * with the original outcome instead of moving money twice. */
  async sweepPending(now = Date.now()) {
    const before = new Date(now - staleAfterMs).toISOString();
    const [stale, voids] = await Promise.all([this.movements.stalePending(before), this.movements.staleVoids(before)]);
    if (!stale.length && !voids.length) return;
    const live = await this.live();
    await Promise.all([(async () => { for (const movement of stale) await this.execute(movement, live); })(), voidAtStripe(this.movements, voids, live)]);
  }

  async refund(bookingId: string, operatorId: string, input: { amountCents: number; reason: string; idempotencyKey: string }) {
    const facts = await this.facts(bookingId);
    if (!facts) return { kind: "not_found" as const };
    const replayed = await this.movements.byKey(`${input.idempotencyKey}:0`);
    if (!replayed) {
      const live = await this.live();
      if ("refusal" in live) return { kind: "refused" as const, reason: live.refusal };
      const summary = ledger(await this.payments.bookingPayment(bookingId), await this.money.snapshot(bookingId), await this.movements.forBooking(bookingId), false, await new Reconciliation(this.db).facts(bookingId));
      const parts = input.amountCents <= summary.refundableCents ? allocateRefund(summary.charges, input.amountCents) : undefined;
      if (!parts?.length) return { kind: "exceeds_refundable" as const, refundableCents: summary.refundableCents };
      await this.movements.insert(parts.map((part, index): NewMovement => ({ bookingId, kind: "refund", amountCents: part.amountCents, taxCents: part.taxCents, actorType: "operator", actorId: operatorId, reason: input.reason, accountId: live.accountId, sourceRef: part.ref, idempotencyKey: `${input.idempotencyKey}:${index}` })));
    } else if (replayed.bookingId !== bookingId) return { kind: "key_reused" as const };
    await this.settle(bookingId);
    return { kind: "done" as const };
  }

  async chargeNoShowFee(bookingId: string, operatorId: string) {
    const [facts, consent, snapshot] = await Promise.all([this.facts(bookingId), this.money.consent(bookingId), this.money.snapshot(bookingId)]);
    if (!facts) return { kind: "not_found" as const };
    if (facts.attendance !== "no_show") return { kind: "not_no_show" as const };
    if (!snapshot?.noShowFeeCents || !consent?.paymentMethodId || consent.noShowFeeCents !== snapshot.noShowFeeCents) return { kind: "no_consented_fee" as const };
    const existing = (await this.movements.forBooking(bookingId)).find(movement => movement.kind === "no_show_fee");
    if (!existing) {
      const live = await this.live();
      if ("refusal" in live) return { kind: "refused" as const, reason: live.refusal };
      await this.movements.insert([{ bookingId, kind: "no_show_fee", amountCents: consent.noShowFeeCents, actorType: "operator", actorId: operatorId, reason: "Marked no-show", accountId: consent.accountId, sourceRef: null, idempotencyKey: `no-show-fee:${bookingId}` }]);
    }
    await this.settle(bookingId);
    return { kind: "done" as const };
  }

  private async execute(movement: Movement, live: Live | { refusal: MoneyRefusal }) {
    if ("refusal" in live || live.accountId !== movement.accountId) { await this.movements.fail(movement.id, "refusal" in live ? live.refusal : "stripe_account_changed"); return; }
    try {
      if (movement.kind === "refund") {
        if (!movement.sourceRef) { await this.movements.fail(movement.id, "refund_source_missing"); return; }
        const refund = movement.processorRef ? await live.api.getRefund(movement.accountId, movement.processorRef) : await live.api.createRefund(movement.accountId, { payment_intent: movement.sourceRef, amount: String(movement.amountCents), "metadata[dial_movement_id]": movement.id, "metadata[dial_booking_id]": movement.bookingId }, `dial-movement-${movement.id}`);
        if (refund.amount !== movement.amountCents || refund.payment_intent !== movement.sourceRef) return;
        if (refund.status === "succeeded") await this.movements.succeed(movement.id, refund.id);
        else if (["pending", "requires_action"].includes(refund.status)) await this.movements.pendingRefund(movement.id, refund.id);
        else await this.movements.fail(movement.id, `refund_${refund.status}`.replace(/[^a-z0-9_]/gi, "").slice(0, 80));
        return;
      }
      const consent = await this.money.consent(movement.bookingId);
      if (!consent?.customerId || !consent.paymentMethodId) { await this.movements.fail(movement.id, "no_saved_card"); return; }
      const facts = await this.facts(movement.bookingId);
      const intent = await live.api.chargeSavedCard(movement.accountId, {
        amount: String(movement.amountCents), currency: "usd", customer: consent.customerId, payment_method: consent.paymentMethodId,
        "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never",
        description: `${movement.kind === "no_show_fee" ? "No-show fee" : "Late-cancellation fee"}: ${facts?.eventTitle ?? "booking"}`.slice(0, 200),
        "metadata[dial_movement_id]": movement.id, "metadata[dial_booking_id]": movement.bookingId,
      }, `dial-movement-${movement.id}`);
      if (intent.status === "succeeded" && intent.amount === movement.amountCents) await this.movements.succeed(movement.id, intent.id, await this.receipt(movement, intent.id));
      else await this.movements.fail(movement.id, `payment_${intent.status}`.replace(/[^a-z0-9_]/gi, "").slice(0, 80));
    } catch (error) {
      // A definite refusal settles the movement as failed and is never retried; a lost or failed transport leaves it
      // pending for the sweep, which repeats the same idempotent request.
      if (error instanceof StripeApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429) await this.movements.fail(movement.id, error.code);
    }
  }

  /** Only a matching signed refund event settles a pending refund; repeats and out-of-order pending events do nothing. */
  async receiveRefundEvent(event: { type: string; account?: string; data: { object: Record<string, unknown> } }, movement: Movement) {
    if (event.account !== movement.accountId) return { kind: "unauthorized" as const };
    if (!["refund.created", "refund.updated", "refund.failed"].includes(event.type)) return { kind: "ignored" as const };
    const object = event.data.object;
    if (typeof object.id !== "string" || (movement.processorRef && object.id !== movement.processorRef) || object.amount !== movement.amountCents || object.payment_intent !== movement.sourceRef || object.currency !== "usd") return { kind: "rejected" as const };
    if (movement.status !== "pending") return { kind: "processed" as const };
    await this.movements.pendingRefund(movement.id, object.id);
    if (object.status === "succeeded") await this.movements.succeed(movement.id, object.id);
    else if (["failed", "canceled"].includes(String(object.status))) await this.movements.fail(movement.id, `refund_${object.status}`);
    return { kind: "processed" as const };
  }

  /** PAY-005: a settled charge's receipt, queued in the same batch that settles it. Fees carry no added tax. */
  async receipt(movement: Movement, ref: string) {
    const audience = await receiptAudience(this.db, movement.bookingId);
    if (!audience) return [];
    const settings = await this.money.settings();
    return receiptStatements(this.db, audience.booking, { ref, kind: movement.kind as ReceiptKind, amountCents: movement.amountCents, taxCents: movement.taxCents, taxSummary: movement.taxSummary, paidAt: nowIso() }, settings.businessName ?? settings.hostName ?? "Dial", audience.operators);
  }

  private facts(bookingId: string) {
    return this.db.prepare(`SELECT b.id, b.state, o.start_at AS startAt, o.end_at AS endAt, b.event_title AS eventTitle, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes,
        b.invitee_email AS inviteeEmail, a.status AS attendance
      FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id LEFT JOIN booking_attendance a ON a.booking_id = b.id WHERE b.id=?`).bind(bookingId).first<BookingFacts>().then(row => row ?? undefined);
  }

  /** The balance link: what is due and until when. It stops working once the meeting starts or the booking is cancelled. */
  async balanceStatus(token: string) {
    const bookingId = await this.money.bookingForBalanceToken(await hashToken(token, this.runtime.SESSION_SECRET));
    if (!bookingId) return { kind: "not_found" as const };
    const [facts, payment, snapshot, movements] = await Promise.all([this.facts(bookingId), this.payments.bookingPayment(bookingId), this.money.snapshot(bookingId), this.movements.forBooking(bookingId)]);
    if (!facts || !snapshot) return { kind: "not_found" as const };
    const summary = ledger(payment, snapshot, movements), balance = movements.find(movement => movement.kind === "balance");
    const state = balance?.status === "succeeded" ? "paid" as const : facts.state === "cancelled" ? "cancelled" as const : facts.startAt <= nowIso() ? "expired" as const : "due" as const;
    return { kind: "found" as const, bookingId, facts, snapshot, status: {
      state, amountCents: snapshot.balanceCents + balanceTaxCents(snapshot), taxCents: balanceTaxCents(snapshot), taxSummary: snapshot.taxSummary, balanceDueCents: summary.balanceDueCents, dueAt: new Date(Date.parse(facts.startAt) - snapshot.balanceDueHours * 3_600_000).toISOString(),
      eventTitle: facts.eventTitle, startAt: facts.startAt, reference: balance?.processorRef ?? null, processing: balance?.status === "pending" && Boolean(balance.checkoutSessionId),
    } };
  }

  /** Open (or reopen) Stripe Checkout for the balance. One balance movement exists per booking, and each Checkout
   * attempt has its own idempotency key, so concurrent clicks share one session and a paid balance is never charged again. */
  async openBalanceCheckout(token: string) {
    const found = await this.balanceStatus(token);
    if (found.kind !== "found") return found;
    if (found.status.state !== "due" || found.status.balanceDueCents <= 0) return { kind: "not_due" as const, state: found.status.state };
    const live = await this.live();
    if ("refusal" in live) return { kind: "refused" as const, reason: live.refusal };
    const key = `balance:${found.bookingId}`, taxCents = balanceTaxCents(found.snapshot);
    await this.movements.insert([{ bookingId: found.bookingId, kind: "balance", amountCents: found.status.balanceDueCents, taxCents, taxSummary: found.snapshot.taxSummary, actorType: "invitee", actorId: null, reason: "Balance after the deposit", accountId: live.accountId, sourceRef: null, idempotencyKey: key }]);
    const movement = await this.movements.byKey(key);
    if (!movement || movement.status !== "pending") return { kind: "not_due" as const, state: "paid" as const };
    if (movement.checkoutUrl) return { kind: "checkout" as const, checkoutUrl: movement.checkoutUrl };
    const returnUrl = new URL(`/manage/balance/${token}`, this.runtime.APP_URL).toString();
    const session = await live.api.createCheckoutSession(live.accountId, {
      mode: "payment", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(movement.amountCents - movement.taxCents),
      "line_items[0][price_data][product_data][name]": `Balance: ${found.facts.eventTitle} (${found.facts.durationMinutes} minutes)`.slice(0, 250),
      ...(movement.taxCents > 0 ? { "line_items[1][quantity]": "1", "line_items[1][price_data][currency]": "usd", "line_items[1][price_data][unit_amount]": String(movement.taxCents), "line_items[1][price_data][product_data][name]": `Sales tax${movement.taxSummary ? ` (${movement.taxSummary})` : ""}`.slice(0, 250) } : {}),
      "excluded_payment_method_types[0]": "us_bank_account",
      success_url: `${returnUrl}?paid=1&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${returnUrl}?canceled=1`,
      expires_at: String(Math.floor(Date.now() / 1000) + balanceCheckoutSeconds), client_reference_id: movement.id, customer_email: found.facts.inviteeEmail,
      "metadata[dial_movement_id]": movement.id, "payment_intent_data[metadata][dial_movement_id]": movement.id,
    }, `dial-balance-${movement.id}-${movement.checkoutAttempt}`);
    if (!session.url) throw new StripeApiError(502, "checkout_url_missing");
    if (await this.movements.attachCheckout(movement.id, session.id, session.url)) return { kind: "checkout" as const, checkoutUrl: session.url };
    // A concurrent request attached its session first: retire this one so the balance can only be paid once.
    if (session.id !== (await this.movements.get(movement.id))?.checkoutSessionId) await live.api.expireCheckoutSession(live.accountId, session.id).catch(() => undefined);
    const current = await this.movements.get(movement.id);
    return current?.checkoutUrl ? { kind: "checkout" as const, checkoutUrl: current.checkoutUrl } : { kind: "not_due" as const, state: "paid" as const };
  }

  /** Stripe's signed events for a balance Checkout. Only these settle the balance; the return URL never does. */
  async receiveBalanceEvent(event: { type: string; account?: string; data: { object: Record<string, unknown> } }, movementId: string) {
    const movement = await this.movements.get(movementId);
    if (!movement || movement.kind !== "balance") return { kind: "ignored" as const };
    if (event.account !== movement.accountId) return { kind: "unauthorized" as const };
    const object = event.data.object;
    const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : typeof object.id === "string" && event.type.startsWith("payment_intent.") ? object.id : null;
    const amount = event.type.startsWith("payment_intent.") ? object.amount_received : object.amount_total;
    switch (event.type) {
      case "checkout.session.completed":
        if (object.payment_status === "unpaid") return { kind: "processed" as const };
      // falls through: a paid session settles the balance
      case "checkout.session.async_payment_succeeded":
      case "payment_intent.succeeded":
        if (movement.status === "succeeded") return { kind: "processed" as const };
        if (amount !== movement.amountCents || object.currency !== "usd" || !paymentIntent) return { kind: "rejected" as const };
        await this.settlePayment(movement, paymentIntent);
        return { kind: "processed" as const, settled: movement.id };
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        if (typeof object.id === "string") await this.movements.clearCheckout(movement.id, object.id);
        return { kind: "processed" as const };
      default:
        return { kind: "ignored" as const };
    }
  }

  /** Erasure asks Stripe to detach the payer's saved card before Dial deletes its references. */
  async detachSavedCard(bookingId: string): Promise<"detached" | "not_saved" | MoneyRefusal | "stripe_failed"> {
    const card = await this.money.savedCard(bookingId);
    if (!card) return "not_saved";
    const live = await this.live();
    if ("refusal" in live) return live.refusal;
    if (live.accountId !== card.accountId) return "stripe_not_connected";
    try { await live.api.detachPaymentMethod(card.accountId, card.paymentMethodId); return "detached"; }
    catch (error) { return error instanceof StripeApiError && error.status === 400 && ["resource_missing", "payment_method_unexpected_state"].includes(error.code) ? "detached" : "stripe_failed"; }
  }
}
