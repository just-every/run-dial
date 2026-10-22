import { formatUsd, priceForDuration, type EventPrice } from "../../shared/event-price";
import { balanceDueAt, cancellationOutcome, cancellationPolicyLines, cardConsentText, cardConsentVersion, cardRequired, freeWindowEndsAt, noPaymentTerms, termsSnapshot, type CancellationOutcome, type PaymentTerms, type TermsSnapshot } from "../../shared/payment-terms";
import type { BookingMoney } from "../payments";
import type { PaymentSummary } from "./types";

/** A booking paid before PAY-003 carries no terms: it reads as the full price with no cancellation policy. */
function snapshotOf(money: BookingMoney): TermsSnapshot {
  return money.snapshot ?? termsSnapshot(noPaymentTerms, money.payment?.amountCents ?? 0);
}

/** The receipt and manage page's view of the booking's money, from the same ledger the operator record reads. */
export function paymentSummary(money: BookingMoney | undefined, startAt: string, open: boolean, now: string): PaymentSummary | undefined {
  if (!money) return undefined;
  const snapshot = snapshotOf(money), { ledger } = money;
  const outcome = cancellationOutcome(snapshot, startAt, now, "invitee");
  const cardSaved = Boolean(money.consent?.paymentMethodId);
  return {
    amountCents: money.payment?.amountCents ?? 0, currency: "usd", reference: money.payment?.checkoutSessionId ?? "",
    kind: money.payment ? money.payment.kind : "setup",
    priceCents: ledger.priceCents, paidCents: ledger.paidCents, refundedCents: ledger.refundedCents, feesCents: ledger.feesCents, netCents: ledger.netCents,
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

/** What the cancellation mail says about the money, decided when the cancellation is recorded. */
export function cancellationNotes(money: BookingMoney | undefined, plan: { outcome: CancellationOutcome; refundCents: number } | undefined, actor: "invitee" | "host") {
  if (!money) return undefined;
  const outcome = plan?.outcome ?? (actor === "host" ? { kind: "none" as const, reason: "host_cancelled" as const } : { kind: "none" as const, reason: "no_policy" as const });
  if (outcome.kind === "refund") return plan?.refundCents ? [`Cancelled inside the free cancellation window: Dial refunds ${formatUsd(plan.refundCents)} to the card that paid.`] : ["Cancelled inside the free cancellation window: nothing was paid, so nothing is refunded or charged."];
  if (outcome.kind === "late_fee") return [`Cancelled after the free cancellation window: a late-cancellation fee of ${formatUsd(outcome.feeCents)} is charged to the saved card.${money.payment ? " What was paid is not refunded." : ""}`];
  if (outcome.reason === "host_cancelled") return ["The host cancelled: Dial issues no automatic refund or fee. The host refunds from the booking record."];
  if (outcome.reason === "late_without_fee") return [`Cancelled after the free cancellation window: ${money.payment ? "what was paid is not refunded" : "nothing is charged"}.`];
  return [money.payment ? "This booking has no cancellation policy: Dial issues no automatic refund. The host can refund from the booking record." : "This booking has no cancellation policy: nothing is charged."];
}

/** What the booking step shows before anything is held: the price, what is due now, the balance and its due
 * time, the cancellation policy and, for stated fees, the unchecked consent the invitee must give. */
export function selectionPayment(price: EventPrice, terms: PaymentTerms, durationMinutes: number, startAt: string) {
  const amountCents = priceForDuration(price, durationMinutes), saveCard = cardRequired(terms);
  if (amountCents === undefined && !saveCard) return undefined;
  const snapshot = termsSnapshot(terms, amountCents ?? 0);
  return {
    amountCents: snapshot.dueNowCents, currency: "usd" as const, mode: snapshot.dueNowCents > 0 ? "payment" as const : "setup" as const,
    priceCents: snapshot.priceCents, depositCents: snapshot.depositCents, balanceCents: snapshot.balanceCents,
    balanceDueAt: balanceDueAt(snapshot, startAt), freeWindowEndsAt: freeWindowEndsAt(snapshot, startAt), policy: cancellationPolicyLines(snapshot),
    ...(saveCard ? { consent: { version: cardConsentVersion, text: cardConsentText(snapshot), lateCancelFeeCents: snapshot.lateCancelFeeCents, noShowFeeCents: snapshot.noShowFeeCents } } : {}),
  };
}

export type PaymentMailFacts = ReturnType<typeof paymentMailFacts>;

/** The payment lines of confirmation and change mails: the first payment, the balance and the policy. */
export function paymentMailFacts(money: { amountCents: number; reference: string; snapshot: TermsSnapshot; balanceUrl?: string }, startAt: string) {
  const { snapshot } = money;
  const due = balanceDueAt(snapshot, startAt);
  return {
    amount: formatUsd(money.amountCents), reference: money.reference,
    kind: snapshot.dueNowCents === 0 ? "setup" as const : snapshot.depositCents > 0 ? "deposit" as const : "payment" as const,
    ...(snapshot.balanceCents > 0 && due ? { balance: formatUsd(snapshot.balanceCents), balanceDueAt: due, ...(money.balanceUrl ? { balanceUrl: money.balanceUrl } : {}) } : {}),
    policy: cancellationPolicyLines(snapshot),
  };
}
