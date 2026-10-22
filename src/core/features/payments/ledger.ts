import { balanceTaxCents, type TermsSnapshot } from "../../shared/payment-terms";
import type { Movement } from "./movements-repository";
import type { BookingPayment } from "./repository";

/** One captured Stripe payment a refund can draw from, with its tax and what is already refunded or being refunded. */
export type Charge = { ref: string; amountCents: number; taxCents: number; refundedCents: number; at: string };
export type Ledger = {
  priceCents: number; paidCents: number; feesCents: number; refundedCents: number; netCents: number;
  /** PAY-005: sales tax collected net of the tax refunded with it. */
  taxCents: number;
  balanceDueCents: number; refundableCents: number; charges: Charge[];
};

/** The booking's money from its first payment and its movements: paid covers the first payment, any balance and
 * any invoice, fees the charged late-cancellation and no-show fees, refunded every refund Stripe accepted. Amounts
 * include their sales tax. A cancelled booking owes no balance. */
export function ledger(payment: BookingPayment | undefined, snapshot: TermsSnapshot | undefined, movements: Movement[], cancelled = false): Ledger {
  const succeeded = movements.filter(movement => movement.status === "succeeded");
  const sum = (kinds: Movement["kind"][], field: "amountCents" | "taxCents" = "amountCents") => succeeded.filter(movement => kinds.includes(movement.kind)).reduce((total, movement) => total + movement[field], 0);
  const balancePaid = sum(["balance"]), feesCents = sum(["late_cancel_fee", "no_show_fee"]), refundedCents = sum(["refund"]);
  const paidCents = (payment?.amountCents ?? 0) + balancePaid + sum(["invoice"]);
  const refunds = movements.filter(movement => movement.kind === "refund" && movement.status !== "failed");
  const charge = (ref: string | null, amountCents: number, taxCents: number, at: string): Charge[] => ref ? [{ ref, amountCents, taxCents, at, refundedCents: refunds.filter(refund => refund.sourceRef === ref).reduce((total, refund) => total + refund.amountCents, 0) }] : [];
  const charges = [
    ...charge(payment?.paymentIntentId ?? null, payment?.amountCents ?? 0, payment?.taxCents ?? 0, payment?.paidAt ?? ""),
    ...succeeded.filter(movement => movement.kind !== "refund").flatMap(movement => charge(movement.processorRef, movement.amountCents, movement.taxCents, movement.updatedAt)),
  ];
  const balanceTotal = snapshot && snapshot.balanceCents > 0 && !cancelled ? snapshot.balanceCents + balanceTaxCents(snapshot) : 0;
  const invoice = movements.find(movement => movement.kind === "invoice" && movement.status !== "failed");
  return {
    priceCents: snapshot?.priceCents ?? payment?.amountCents ?? (invoice ? invoice.amountCents - invoice.taxCents : 0),
    paidCents, feesCents, refundedCents, netCents: paidCents + feesCents - refundedCents,
    taxCents: (payment?.taxCents ?? 0) + sum(["balance", "invoice"], "taxCents") - sum(["refund"], "taxCents"),
    balanceDueCents: Math.max(0, balanceTotal - balancePaid),
    refundableCents: charges.reduce((total, entry) => total + entry.amountCents - entry.refundedCents, 0),
    charges,
  };
}

/** Split a refund across captured payments, newest first, so each Stripe refund stays within its payment; each part
 * refunds its payment's sales tax in proportion. */
export function allocateRefund(charges: Charge[], amountCents: number) {
  const parts: Array<{ ref: string; amountCents: number; taxCents: number }> = [];
  let left = amountCents;
  for (const entry of [...charges].sort((a, b) => b.at.localeCompare(a.at))) {
    const available = entry.amountCents - entry.refundedCents;
    if (left <= 0 || available <= 0) continue;
    const part = Math.min(available, left);
    parts.push({ ref: entry.ref, amountCents: part, taxCents: entry.amountCents ? Math.round(part * entry.taxCents / entry.amountCents) : 0 });
    left -= part;
  }
  return left > 0 ? undefined : parts;
}
