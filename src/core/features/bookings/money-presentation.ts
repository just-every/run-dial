import { formatUsd, priceForDuration, type EventPrice } from "../../shared/event-price";
import { balanceDueAt, cancellationOutcome, cancellationPolicyLines, cardConsentText, cardConsentVersion, cardRequired, dueNowTaxCents, freeWindowEndsAt, noPaymentTerms, termsSnapshot, type PaymentTerms, type TermsSnapshot } from "../../shared/payment-terms";
import type { BookingMoney, CancellationPlan } from "../payments";
import type { PaymentSummary } from "./types";

/** A booking paid before PAY-003, or invoiced (PAY-005), carries no terms: it reads as its amount with no cancellation policy. */
function snapshotOf(money: BookingMoney): TermsSnapshot {
  return money.snapshot ?? termsSnapshot(noPaymentTerms, money.payment?.amountCents ?? money.movements.find(movement => movement.kind === "invoice")?.amountCents ?? 0);
}

/** The receipt and manage page's view of the booking's money, from the same ledger the operator record reads. */
export function paymentSummary(money: BookingMoney | undefined, startAt: string, open: boolean, now: string, businessName: string): PaymentSummary | undefined {
  if (!money) return undefined;
  const invoice = money.movements.find(movement => movement.kind === "invoice" && movement.invoiceUrl && movement.status !== "failed");
  // PAY-005: the receipt page lists each payment with its tax and Stripe reference, as its receipt email does.
  const payments = [
    ...(money.payment ? [{ kind: money.payment.kind as string, amountCents: money.payment.amountCents, taxCents: money.payment.taxCents, reference: money.payment.checkoutSessionId, paidAt: money.payment.paidAt }] : []),
    ...money.movements.filter(movement => movement.status === "succeeded" && movement.kind !== "refund").map(movement => ({ kind: movement.kind as string, amountCents: movement.amountCents, taxCents: movement.taxCents, reference: movement.processorRef ?? "", paidAt: movement.updatedAt })),
  ];
  const snapshot = snapshotOf(money), { ledger } = money;
  const outcome = cancellationOutcome(snapshot, startAt, now);
  const cardSaved = Boolean(money.consent?.paymentMethodId);
  return {
    amountCents: money.payment?.amountCents ?? 0, currency: "usd", reference: money.payment?.checkoutSessionId ?? "",
    kind: money.payment ? money.payment.kind : money.consent ? "setup" : "invoice",
    priceCents: ledger.priceCents, paidCents: ledger.paidCents, refundedCents: ledger.refundedCents, feesCents: ledger.feesCents, netCents: ledger.netCents,
    taxCents: ledger.taxCents, taxSummary: money.payment?.taxSummary ?? snapshot.taxSummary, businessName, payments,
    ...(invoice ? { invoice: { url: invoice.invoiceUrl!, number: invoice.invoiceNumber, amountCents: invoice.amountCents, taxCents: invoice.taxCents, paid: invoice.status === "succeeded" } } : {}),
    balanceDueCents: ledger.balanceDueCents, balanceDueAt: ledger.balanceDueCents > 0 ? balanceDueAt(snapshot, startAt) : null,
    ...(money.balanceUrl ? { balanceUrl: money.balanceUrl } : {}),
    freeWindowEndsAt: freeWindowEndsAt(snapshot, startAt),
    policy: cancellationPolicyLines(snapshot),
    cardSaved,
    movements: money.movements.map(movement => ({ kind: movement.kind, amountCents: movement.amountCents, status: movement.status, createdAt: movement.createdAt, reference: movement.processorRef })),
    ...(open ? { cancellation: outcome.kind === "refund" ? { outcome: "refund" as const, amountCents: ledger.refundableCents }
      : outcome.kind === "late_fee" && cardSaved ? { outcome: "late_fee" as const, amountCents: outcome.feeCents } : { outcome: "none" as const, amountCents: 0 } } : {}),
  };
}

/** What the cancellation mail says about the money, decided when the cancellation is recorded: the refund or fee,
 * and that an open invoice or a balance can no longer be paid. */
export function cancellationNotes(money: BookingMoney | undefined, plan: CancellationPlan | undefined) {
  if (!money) return undefined;
  const voids = [
    ...(plan?.voids.includes("invoice") ? ["The open invoice is void and can no longer be paid."] : []),
    ...(plan?.voids.includes("balance") || money.ledger.balanceDueCents > 0 ? ["The balance is no longer due."] : []),
  ];
  return [outcomeNote(money, plan), ...(plan?.refundCents ? ["This is a refund request, not confirmation that money has been refunded. Stripe may keep it pending or fail it; check the booking receipt for the completed amount."] : []), ...voids];
}

function outcomeNote(money: BookingMoney, plan: CancellationPlan | undefined) {
  const outcome = plan?.outcome ?? { kind: "none" as const, reason: "no_policy" as const };
  if (outcome.kind === "host_refund") {
    if (outcome.refundableCents === 0) return "The host cancelled: nothing was paid, so nothing is refunded. No fee is charged.";
    if (outcome.reason === undefined) return `The host cancelled: Dial refunds everything paid, ${formatUsd(plan!.refundCents)}, to the card that paid. No fee is charged.`;
    return `The host cancelled and refunds ${plan!.refundCents ? formatUsd(plan!.refundCents) : "nothing"} of the ${formatUsd(outcome.refundableCents)} paid. Reason: ${outcome.reason.replace(/[.\s]+$/u, "")}. No fee is charged.`;
  }
  if (outcome.kind === "refund") return plan?.refundCents ? `Cancelled inside the free cancellation window: Dial refunds ${formatUsd(plan.refundCents)} to the card that paid.` : "Cancelled inside the free cancellation window: nothing was paid, so nothing is refunded or charged.";
  if (outcome.kind === "late_fee") return `Cancelled after the free cancellation window: a late-cancellation fee of ${formatUsd(outcome.feeCents)} is charged to the saved card.${money.payment ? " What was paid is not refunded." : ""}`;
  if (outcome.reason === "late_without_fee") return `Cancelled after the free cancellation window: ${money.payment ? "what was paid is not refunded" : "nothing is charged"}.`;
  return money.payment ? "This booking has no cancellation policy: Dial issues no automatic refund. The host can refund from the booking record." : "This booking has no cancellation policy: nothing is charged.";
}

/** What the booking step shows before anything is held: the price, what is due now, the balance and its due
 * time, the cancellation policy and, for stated fees, the unchecked consent the invitee must give. */
export function selectionPayment(price: EventPrice, terms: PaymentTerms, durationMinutes: number, startAt: string, taxEnabled: boolean) {
  const amountCents = priceForDuration(price, durationMinutes), saveCard = cardRequired(terms);
  if (amountCents === undefined && !saveCard) return undefined;
  const snapshot = termsSnapshot(terms, amountCents ?? 0);
  return {
    amountCents: snapshot.dueNowCents, currency: "usd" as const, mode: snapshot.dueNowCents > 0 ? "payment" as const : "setup" as const,
    priceCents: snapshot.priceCents, depositCents: snapshot.depositCents, balanceCents: snapshot.balanceCents,
    balanceDueAt: balanceDueAt(snapshot, startAt), freeWindowEndsAt: freeWindowEndsAt(snapshot, startAt), policy: cancellationPolicyLines(snapshot),
    // PAY-005: with Stripe Tax on, the invitee's billing address prices the sales tax before anything is held.
    taxRequired: taxEnabled && snapshot.priceCents > 0,
    ...(saveCard ? { consent: { version: cardConsentVersion(snapshot), text: cardConsentText(snapshot), lateCancelFeeCents: snapshot.lateCancelFeeCents, noShowFeeCents: snapshot.noShowFeeCents } } : {}),
  };
}

export type PaymentMailFacts = ReturnType<typeof paymentMailFacts>;

/** The payment lines of confirmation and change mails: the first payment, the balance and the policy. */
export function paymentMailFacts(money: { amountCents: number; reference: string; snapshot: TermsSnapshot; balanceUrl?: string }, startAt: string) {
  const { snapshot } = money;
  const due = balanceDueAt(snapshot, startAt), tax = dueNowTaxCents(snapshot), balanceTax = snapshot.taxCents - tax;
  return {
    amount: formatUsd(money.amountCents), reference: money.reference,
    kind: snapshot.dueNowCents === 0 ? "setup" as const : snapshot.depositCents > 0 ? "deposit" as const : "payment" as const,
    ...(tax > 0 ? { tax: `${formatUsd(tax)} included${snapshot.taxSummary ? ` (${snapshot.taxSummary})` : ""}` } : {}),
    ...(snapshot.balanceCents > 0 && due ? { balance: formatUsd(snapshot.balanceCents + balanceTax), balanceDueAt: due, ...(money.balanceUrl ? { balanceUrl: money.balanceUrl } : {}) } : {}),
    policy: cancellationPolicyLines(snapshot),
  };
}
