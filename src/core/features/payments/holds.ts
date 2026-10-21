/** An active payment hold (held or processing) occupies its slot like a confirmed booking (BOOK-002). It stays
 * active until Dial expires its Checkout Session or Stripe reports the payment failed, so a payer who can still
 * pay never loses the slot to another invitee. */
export const activeHoldStates = "('held', 'processing')";

export function paymentHoldPredicate(startAt: string, endAt: string, exceptHoldId?: string) {
  return {
    sql: `NOT EXISTS (SELECT 1 FROM payment_holds h WHERE h.state IN ${activeHoldStates} AND h.occupied_start_at < ? AND h.occupied_end_at > ? AND (? IS NULL OR h.id <> ?))`,
    params: [endAt, startAt, exceptHoldId ?? null, exceptHoldId ?? null],
  };
}

/** Held intervals for availability, in the same shape as internal booking claims. */
export async function activeHoldIntervals(binding: D1Database, startAt: string, endAt: string) {
  const result = await binding.prepare(`SELECT occupied_start_at AS startAt, occupied_end_at AS endAt, '' AS hostDate, start_at AS bookingStartAt, end_at AS bookingEndAt
    FROM payment_holds WHERE state IN ${activeHoldStates} AND occupied_start_at < ? AND occupied_end_at > ?`).bind(endAt, startAt)
    .all<{ startAt: string; endAt: string; hostDate: string; bookingStartAt: string; bookingEndAt: string }>();
  return result.results;
}
