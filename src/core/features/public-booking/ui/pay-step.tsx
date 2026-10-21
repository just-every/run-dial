import { formatUsd } from "../../../shared/event-price";

/** PAY-001's pay step: what is charged, by whom, and that the booking waits for Stripe's confirmation. */
export function PayStepNotice({ amountCents }: { amountCents: number }) {
  return <div className="pb-pay-step" role="note"><p className="pb-pay-amount">{formatUsd(amountCents)}</p><p>You pay securely on Stripe Checkout (card, Apple Pay, Google Pay or Link; US bank account when the host allows it). Your time is held for 10 minutes while you pay, and the booking is confirmed as soon as Stripe confirms the payment. Dial never sees your card number.</p></div>;
}

/** The amount and Stripe reference on the receipt and manage page, with PAY-001's refund statement. */
export function PaymentSummary({ payment, changes = false }: { payment: { amountCents: number; reference: string }; changes?: boolean }) {
  return <div className="pb-payment-summary"><p><strong>Paid {formatUsd(payment.amountCents)}</strong> · Stripe reference <code>{payment.reference}</code></p>{changes ? <p>No refund is issued by Dial if you cancel or reschedule. The host refunds payments in Stripe.</p> : null}</div>;
}
