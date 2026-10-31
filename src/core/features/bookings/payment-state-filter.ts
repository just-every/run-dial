export const bookingPaymentStates = ["free", "unpaid", "paid", "balance_due", "refunded"] as const;
export type BookingPaymentState = typeof bookingPaymentStates[number];

/** Read-only classification of existing money facts, with booking alias b.
 * A successful partial or full refund wins over every other state. Pending and
 * failed refunds do not count. A live deposit balance includes its remaining
 * tax, less successful balance payments; cancellation waives that balance, as
 * in the payment ledger. Captured payments, invoices and fees then count as
 * paid. Without a capture, a priced snapshot or open invoice is unpaid;
 * otherwise the booking is free. No provider call or money mutation occurs.
 */
export const bookingPaymentStateSql = `CASE
  WHEN EXISTS (SELECT 1 FROM payment_movements m
    WHERE m.booking_id = b.id AND m.kind = 'refund' AND m.status = 'succeeded')
    OR EXISTS (SELECT 1 FROM payment_processor_facts f
      WHERE f.booking_id = b.id AND f.kind = 'refund' AND f.status = 'succeeded' AND f.amount_cents > 0
        AND NOT EXISTS (SELECT 1 FROM payment_movements m WHERE m.booking_id = b.id AND m.processor_ref = f.processor_ref))
    THEN 'refunded'
  WHEN b.state <> 'cancelled' AND EXISTS (SELECT 1 FROM booking_payment_terms t
    WHERE t.booking_id = b.id AND t.balance_cents > 0
      AND t.balance_cents + t.tax_cents
        - CASE WHEN t.price_cents > 0 AND t.tax_cents > 0
          THEN ROUND(1.0 * t.tax_cents * t.due_now_cents / t.price_cents) ELSE 0 END
        > COALESCE((SELECT SUM(m.amount_cents) FROM payment_movements m
          WHERE m.booking_id = b.id AND m.kind = 'balance' AND m.status = 'succeeded'), 0))
    THEN 'balance_due'
  WHEN EXISTS (SELECT 1 FROM booking_payments p WHERE p.booking_id = b.id)
    OR EXISTS (SELECT 1 FROM payment_movements m WHERE m.booking_id = b.id
      AND m.kind IN ('balance', 'invoice', 'late_cancel_fee', 'no_show_fee') AND m.status = 'succeeded')
    THEN 'paid'
  WHEN EXISTS (SELECT 1 FROM booking_payment_terms t WHERE t.booking_id = b.id AND t.price_cents > 0)
    OR EXISTS (SELECT 1 FROM payment_movements m
      WHERE m.booking_id = b.id AND m.kind = 'invoice' AND m.status = 'pending')
    THEN 'unpaid'
  ELSE 'free'
END`;
