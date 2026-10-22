import { formatUsd } from "../../../shared/event-price";
import { format } from "./flow-shell";
import type { PaymentSummaryView, SelectionPayment } from "./types";

function Policy({ lines }: { lines: string[] }) {
  return <section className="pb-change-terms" aria-label="Cancellation policy"><h2>Cancellation policy</h2>{lines.map(line => <p key={line}>{line}</p>)}</section>;
}

/** The pay step (PAY-001, PAY-003): what is charged now, the balance and when it is due, the cancellation policy,
 * and the unchecked consent a booking with stated fees needs before anything is held. */
export function PayStepNotice({ payment, timezone, consented, onConsent, error }: { payment: SelectionPayment; timezone: string; consented: boolean; onConsent(value: boolean): void; error?: string }) {
  return <div className="pb-pay-step" role="note">
    <p className="pb-pay-amount">{payment.mode === "setup" ? "Nothing to pay now" : `${formatUsd(payment.amountCents)}${payment.taxRequired ? " plus sales tax" : ""}`}</p>
    {payment.depositCents > 0 && payment.balanceDueAt ? <p>This is a deposit on the {formatUsd(payment.priceCents)} price. The balance of {formatUsd(payment.balanceCents)} is due by {format(payment.balanceDueAt, timezone)}; Dial emails you a link to pay it.</p> : null}
    <p>{payment.mode === "setup" ? "Stripe saves your card on its secure page; nothing is charged now. Dial never sees your card number." : "You pay securely on Stripe Checkout (card, Apple Pay, Google Pay or Link; US bank account when the host allows it). Your time is held for 10 minutes while you pay, and the booking is confirmed as soon as Stripe confirms the payment. Dial never sees your card number."}</p>
    <Policy lines={payment.policy} />
    {payment.consent ? <label className="pb-consent"><input type="checkbox" checked={consented} aria-invalid={Boolean(error)} aria-describedby={error ? "card-consent-error" : undefined} onChange={event => onConsent(event.target.checked)} /><span>{payment.consent.text}</span></label> : null}
    {error ? <p id="card-consent-error" className="pb-field-error">{error}</p> : null}
  </div>;
}

/** The booking's money on the receipt and manage page: what was paid, the balance and its link, refunds and fees,
 * and the cancellation policy it was booked under. */
const paymentLabels: Record<string, string> = { payment: "Payment", deposit: "Deposit", balance: "Balance", invoice: "Invoice payment", late_cancel_fee: "Late-cancellation fee", no_show_fee: "No-show fee" };

export function PaymentSummary({ payment, timezone, open = true }: { payment: PaymentSummaryView; timezone: string; open?: boolean }) {
  const payments = payment.payments && payment.payments.length > 1 ? payment.payments : undefined;
  return <div className="pb-payment-summary">
    {payment.businessName ? <p>Paid to {payment.businessName}</p> : null}
    {payment.kind === "invoice" && payment.invoice ? <p><strong>{payment.invoice.paid ? "Invoice paid" : "Invoice issued"} {formatUsd(payment.invoice.amountCents)}</strong>{payment.invoice.number ? <> · Invoice <code>{payment.invoice.number}</code></> : null}</p>
      : payments ? null : <p><strong>{payment.kind === "setup" ? "Card saved with Stripe for the stated fees" : `${payment.kind === "deposit" ? "Deposit paid" : "Paid"} ${formatUsd(payment.amountCents)}`}</strong>{payment.reference ? <> · Stripe reference <code>{payment.reference}</code></> : null}</p>}
    {payments ? <ul aria-label="Payments">{payments.map(entry => <li key={`${entry.kind}:${entry.reference}`}>{paymentLabels[entry.kind] ?? entry.kind}: {formatUsd(entry.amountCents)}{entry.taxCents ? ` (sales tax ${formatUsd(entry.taxCents)})` : ""} · <code>{entry.reference}</code></li>)}</ul> : null}
    {payment.taxCents ? <p>Sales tax included: {formatUsd(payment.taxCents)}{payment.taxSummary ? ` (${payment.taxSummary})` : ""}</p> : null}
    {payment.invoice && !payment.invoice.paid && open ? <p>Invoice {payment.invoice.number ?? ""} for {formatUsd(payment.invoice.amountCents)}: <a href={payment.invoice.url}>Pay the invoice on Stripe</a></p> : null}
    {payment.balanceDueCents > 0 && payment.balanceDueAt ? <p>Balance due: {formatUsd(payment.balanceDueCents)} by {format(payment.balanceDueAt, timezone)}.{payment.balanceUrl && open ? <> <a href={payment.balanceUrl}>Pay the balance</a></> : null}</p> : null}
    {payment.paidCents !== payment.amountCents ? <p>Paid in all: {formatUsd(payment.paidCents)}</p> : null}
    {payment.feesCents ? <p>Fees charged: {formatUsd(payment.feesCents)}</p> : null}
    {payment.refundedCents ? <p>Refunded: {formatUsd(payment.refundedCents)}</p> : null}
    <Policy lines={payment.policy} />
  </div>;
}

/** The manage page's confirmation names what cancelling now does to the money. */
export function cancelPrompt(payment?: PaymentSummaryView) {
  const outcome = payment?.cancellation;
  if (outcome?.outcome === "refund" && outcome.amountCents > 0) return `Cancel this booking? This cannot be undone. You are inside the free cancellation window, so Dial refunds ${formatUsd(outcome.amountCents)} to your card automatically.`;
  if (outcome?.outcome === "late_fee") return `Cancel this booking? This cannot be undone. The free cancellation window has passed, so the ${formatUsd(outcome.amountCents)} late-cancellation fee is charged to your saved card.`;
  if (payment && payment.paidCents > 0) return "Cancel this booking? This cannot be undone. Under this booking's policy Dial issues no automatic refund; the host can still refund you.";
  return "Cancel this booking? This cannot be undone.";
}
