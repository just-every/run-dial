import type { ProcessorFact } from "./reconciliation";
import { balanceTaxCents, type TermsSnapshot } from "../../shared/payment-terms";
import type { Movement } from "./movements-repository";
import type { BookingPayment } from "./repository";

/** One captured Stripe payment a refund can draw from, with its tax and what is already refunded or being refunded. */
export type Charge = { ref: string; amountCents: number; taxCents: number; refundedCents: number; refundedTaxCents: number; at: string };
export type Ledger = {
  priceCents: number; paidCents: number; feesCents: number; refundedCents: number; netCents: number;
  /** PAY-005: sales tax collected net of the tax refunded with it. */
  taxCents: number;
  balanceDueCents: number; refundableCents: number; charges: Charge[];
};

/** The booking's money from its first payment and its movements: paid covers the first payment, any balance and
 * any invoice, fees the charged late-cancellation and no-show fees, refunded every refund Stripe accepted. Amounts
 * include their sales tax. A cancelled booking owes no balance. */
export function ledger(payment: BookingPayment | undefined, snapshot: TermsSnapshot | undefined, movements: Movement[], cancelled = false, facts: ProcessorFact[] = []): Ledger {
  const succeeded = movements.filter(movement => movement.status === "succeeded");
  const sum = (kinds: Movement["kind"][], field: "amountCents" | "taxCents" = "amountCents") => succeeded.filter(movement => kinds.includes(movement.kind)).reduce((total, movement) => total + movement[field], 0);
  const external = facts.filter(f => f.kind === "refund" && !["failed","canceled"].includes(f.status) && !movements.some(m => m.processorRef === f.processorRef));
  const balancePaid = sum(["balance"]), feesCents = sum(["late_cancel_fee", "no_show_fee"]), refundedCents = sum(["refund"]) + external.filter(f=>f.status==="succeeded").reduce((n,f)=>n+f.amountCents,0);
  const paidCents = (payment?.amountCents ?? 0) + balancePaid + sum(["invoice"]);
  const externalTax=(ref:string,amount:number,tax:number,succeededOnly=false)=>{const ours=movements.filter(m=>m.kind==='refund'&&m.sourceRef===ref&&(succeededOnly?m.status==='succeeded':m.status!=='failed'));const other=external.filter(f=>f.sourceRef===ref&&(!succeededOnly||f.status==='succeeded')).reduce((n,f)=>n+f.amountCents,0);return other?Math.max(0,Math.min(tax,Math.round((ours.reduce((n,m)=>n+m.amountCents,0)+other)*tax/amount))-ours.reduce((n,m)=>n+m.taxCents,0)):0;};
  const externalRefundTax=externalTax(payment?.paymentIntentId??'',payment?.amountCents??1,payment?.taxCents??0,true)+succeeded.filter(m=>m.kind!=='refund').reduce((n,m)=>n+externalTax(m.processorRef??'',m.amountCents,m.taxCents,true),0);
  const refunds = movements.filter(movement => movement.kind === "refund" && movement.status !== "failed");
  const charge = (ref: string | null, amountCents: number, taxCents: number, at: string): Charge[] => {
    if (!ref) return [];
    const reserved = refunds.filter(refund => refund.sourceRef === ref);
    return [{ ref, amountCents, taxCents, at,
      refundedCents: reserved.reduce((total, refund) => total + refund.amountCents, 0) + external.filter(f=>f.sourceRef===ref).reduce((n,f)=>n+f.amountCents,0),
      refundedTaxCents: reserved.reduce((total, refund) => total + refund.taxCents, 0) + externalTax(ref,amountCents,taxCents),
    }];
  };
  const charges = [
    ...charge(payment?.paymentIntentId ?? null, payment?.amountCents ?? 0, payment?.taxCents ?? 0, payment?.paidAt ?? ""),
    ...succeeded.filter(movement => movement.kind !== "refund").flatMap(movement => charge(movement.processorRef, movement.amountCents, movement.taxCents, movement.updatedAt)),
  ];
  const balanceTotal = snapshot && snapshot.balanceCents > 0 && !cancelled ? snapshot.balanceCents + balanceTaxCents(snapshot) : 0;
  const invoice = movements.find(movement => movement.kind === "invoice" && movement.status !== "failed");
  return {
    priceCents: snapshot?.priceCents ?? payment?.amountCents ?? (invoice ? invoice.amountCents - invoice.taxCents : 0),
    paidCents, feesCents, refundedCents, netCents: paidCents + feesCents - refundedCents,
    taxCents: (payment?.taxCents ?? 0) + sum(["balance", "invoice"], "taxCents") - sum(["refund"], "taxCents") - externalRefundTax,
    balanceDueCents: Math.max(0, balanceTotal - balancePaid),
    refundableCents: charges.reduce((total, entry) => total + Math.max(0,entry.amountCents - entry.refundedCents), 0),
    charges,
  };
}

/** Split a refund across captured payments, newest first, so each Stripe refund stays within its payment. Round
 * cumulative tax once per charge and subtract tax already refunded or reserved, so partial refunds conserve tax. */
export function allocateRefund(charges: Charge[], amountCents: number) {
  const parts: Array<{ ref: string; amountCents: number; taxCents: number }> = [];
  let left = amountCents;
  for (const entry of [...charges].sort((a, b) => b.at.localeCompare(a.at))) {
    const available = entry.amountCents - entry.refundedCents;
    if (left <= 0 || available <= 0) continue;
    const part = Math.min(available, left);
    const cumulativeTaxCents = Math.round((entry.refundedCents + part) * entry.taxCents / entry.amountCents);
    // Older individually rounded refunds can exceed this cumulative target. Keep their history and allocate no
    // additional tax until the target catches up; a refund never carries negative tax.
    const taxCents = Math.max(0, cumulativeTaxCents - entry.refundedTaxCents);
    parts.push({ ref: entry.ref, amountCents: part, taxCents });
    left -= part;
  }
  return left > 0 ? undefined : parts;
}
