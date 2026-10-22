import type { TermsSnapshot } from "../../shared/payment-terms";
import type { Movement } from "./movements-repository";
import type { BookingPayment } from "./repository";

/** One captured Stripe payment a refund can draw from, with what is already refunded or being refunded. */
export type Charge = { ref: string; amountCents: number; refundedCents: number; at: string };
export type Ledger = {
  priceCents: number; paidCents: number; feesCents: number; refundedCents: number; netCents: number;
  balanceDueCents: number; refundableCents: number; charges: Charge[];
};

/** The booking's money from its first payment and its movements: paid covers the first payment and any balance,
 * fees the charged late-cancellation and no-show fees, refunded every refund Stripe accepted. */
export function ledger(payment: BookingPayment | undefined, snapshot: TermsSnapshot | undefined, movements: Movement[]): Ledger {
  const succeeded = movements.filter(movement => movement.status === "succeeded");
  const sum = (kinds: Movement["kind"][]) => succeeded.filter(movement => kinds.includes(movement.kind)).reduce((total, movement) => total + movement.amountCents, 0);
  const balancePaid = sum(["balance"]), feesCents = sum(["late_cancel_fee", "no_show_fee"]), refundedCents = sum(["refund"]);
  const paidCents = (payment?.amountCents ?? 0) + balancePaid;
  const refunds = movements.filter(movement => movement.kind === "refund" && movement.status !== "failed");
  const charge = (ref: string | null, amountCents: number, at: string): Charge[] => ref ? [{ ref, amountCents, at, refundedCents: refunds.filter(refund => refund.sourceRef === ref).reduce((total, refund) => total + refund.amountCents, 0) }] : [];
  const charges = [
    ...charge(payment?.paymentIntentId ?? null, payment?.amountCents ?? 0, payment?.paidAt ?? ""),
    ...succeeded.filter(movement => movement.kind !== "refund").flatMap(movement => charge(movement.processorRef, movement.amountCents, movement.updatedAt)),
  ];
  return {
    priceCents: snapshot?.priceCents ?? payment?.amountCents ?? 0,
    paidCents, feesCents, refundedCents, netCents: paidCents + feesCents - refundedCents,
    balanceDueCents: Math.max(0, (snapshot?.balanceCents ?? 0) - balancePaid),
    refundableCents: charges.reduce((total, entry) => total + entry.amountCents - entry.refundedCents, 0),
    charges,
  };
}

/** Split a refund across captured payments, newest first, so each Stripe refund stays within its payment. */
export function allocateRefund(charges: Charge[], amountCents: number) {
  const parts: Array<{ ref: string; amountCents: number }> = [];
  let left = amountCents;
  for (const entry of [...charges].sort((a, b) => b.at.localeCompare(a.at))) {
    const available = entry.amountCents - entry.refundedCents;
    if (left <= 0 || available <= 0) continue;
    const part = Math.min(available, left);
    parts.push({ ref: entry.ref, amountCents: part });
    left -= part;
  }
  return left > 0 ? undefined : parts;
}
