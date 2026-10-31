/** Confirmed current occurrences are the durable seat ledger. Cancelling or erasing one
 * booking releases only that booking's seat, in the existing booking transaction. */
type Placement = {
  eventId: string;
  startAt: string;
  endAt: string;
  occupiedStartAt: string;
  occupiedEndAt: string;
  excludedBookingId?: string;
};

export function slotLedgerPredicate(input: Placement) {
  const excluded = input.excludedBookingId ?? null;
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM booking_occurrences occurrence
      JOIN bookings existing ON existing.id = occurrence.booking_id
      WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1
        AND existing.state IN ('confirmed', 'rescheduled')
        AND (? IS NULL OR existing.id <> ?)
        AND occurrence.occupied_start_at < ? AND occurrence.occupied_end_at > ?
        AND NOT (
          existing.event_type_id IS ? AND occurrence.start_at = ? AND occurrence.end_at = ?
          AND occurrence.occupied_start_at = ? AND occurrence.occupied_end_at = ?
          AND EXISTS (SELECT 1 FROM event_types e WHERE e.id = ? AND e.group_capacity IS NOT NULL)
        )
    ) AND (
      SELECT count(*) FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id
      WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled')
        AND b.event_type_id = ? AND o.start_at = ? AND o.end_at = ?
        AND (? IS NULL OR b.id <> ?)
    ) < COALESCE((SELECT group_capacity FROM event_types WHERE id = ?), 1)`,
    params: [excluded, excluded, input.occupiedEndAt, input.occupiedStartAt,
      input.eventId, input.startAt, input.endAt, input.occupiedStartAt, input.occupiedEndAt, input.eventId,
      input.eventId, input.startAt, input.endAt, excluded, excluded, input.eventId],
  };
}

/** A fresh configuration check inside the claim transaction fences a stale offer.
 * Unsupported payment, approval and calendar combinations never create a group seat. */
export function groupClaimPredicate(eventId: string, capacity?: number | null) {
  return {
    sql: `EXISTS (
      SELECT 1 FROM event_types e WHERE e.id = ? AND e.group_capacity IS ?
        AND (e.group_capacity IS NULL OR (
          e.approval_required = 0 AND e.guest_limit = 0
          AND NOT EXISTS (SELECT 1 FROM calendar_connections WHERE status <> 'disconnected')
          AND NOT EXISTS (SELECT 1 FROM event_type_prices WHERE event_type_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM event_type_payment_terms WHERE event_type_id = e.id
            AND (deposit_kind <> 'none' OR late_cancel_fee_cents > 0 OR no_show_fee_cents > 0))
        ))
    )`,
    params: [eventId, capacity ?? null],
  };
}

type ClaimInterval = {
  eventTypeId?: string | null;
  startAt: string;
  endAt: string;
  bookingStartAt?: string;
  bookingEndAt?: string;
};

/** Only seats of this exact event and placement share time. Neighbouring group
 * starts, buffers and ordinary bookings continue to exclude the whole slot. */
export function isSameGroupSlot(claim: ClaimInterval, input: Placement) {
  return claim.eventTypeId === input.eventId
    && claim.bookingStartAt === input.startAt && claim.bookingEndAt === input.endAt
    && claim.startAt === input.occupiedStartAt && claim.endAt === input.occupiedEndAt;
}
