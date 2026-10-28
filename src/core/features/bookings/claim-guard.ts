import { routingGuard } from "../routing";
import { offeredHoldPredicate } from "../booking-links";
import { BookingLimits, approvalHoldPredicate } from "../availability";
import { blockedAddressSql, blockedAddressValues } from "../public-abuse";
import { paymentHoldPredicate } from "../payments";
import type { BookingClaim } from "./types";

type Admission = { sql: string; params: unknown[] };
type GuardInput = Pick<BookingClaim, "event" | "hostTimezone" | "selection" | "invitee" | "occupiedStartAt" | "occupiedEndAt" | "hostDate"> & Partial<Pick<BookingClaim,"routing"|"bookingId">>;

/** The single atomic slot check (BOOK-002) shared by a free confirmation, a payment hold and a paid
 * conversion: no blocked address, an admitting capability, no overlapping booking or active payment hold,
 * the host-day cap, offered-time holds and booking limits. */
export async function slotClaimGuard(binding: D1Database, input: GuardInput, admission: Admission, linkId?: string | null, exceptHoldId?: string, exceptApprovalId?: string) {
  if(input.routing && input.bookingId){const route=routingGuard(input.routing,input.event.id,input.bookingId);admission={sql:`(${admission.sql}) AND ${route.sql}`,params:[...admission.params,...route.params]};}
  const holds = offeredHoldPredicate(input.occupiedStartAt, input.occupiedEndAt, linkId ?? undefined);
  const limits = await new BookingLimits(binding).predicate(input.event.id, input.hostTimezone, input.selection.startAt, input.selection.endAt, input.invitee.email, undefined);
  const approval = approvalHoldPredicate(input.occupiedStartAt,input.occupiedEndAt,exceptApprovalId);
  const paid = paymentHoldPredicate(input.occupiedStartAt, input.occupiedEndAt, exceptHoldId);
  return {
    sql: `NOT ${blockedAddressSql}
      AND ${admission.sql}
      AND NOT EXISTS (
        SELECT 1 FROM booking_occurrences occurrence
        JOIN bookings existing ON existing.id = occurrence.booking_id
        WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1
          AND existing.state IN ('confirmed', 'rescheduled')
          AND occurrence.occupied_start_at < ?
          AND occurrence.occupied_end_at > ?
      ) AND (? IS NULL OR (SELECT count(*) FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled') AND o.host_date = ?) < ?) AND ${holds.sql} AND ${limits.sql} AND ${paid.sql} AND ${approval.sql}`,
    params: [...blockedAddressValues(input.invitee.email), ...admission.params, input.occupiedEndAt, input.occupiedStartAt, input.event.hostDayBookingLimit, input.hostDate, input.event.hostDayBookingLimit, ...holds.params, ...limits.params, ...paid.params, ...approval.params],
  };
}

/** A public confirmation is admitted by its unconsumed, unexpired selection nonce and any still-valid link. */
export function nonceAdmission(nonceId: string, nonceHash: string, now: string): Admission {
  return {
    sql: `EXISTS (SELECT 1 FROM booking_nonces n WHERE n.id = ? AND n.nonce_hash = ? AND n.consumed_at IS NULL AND n.expires_at > ?
      AND (n.link_id IS NULL OR EXISTS (SELECT 1 FROM booking_links l JOIN booking_link_tokens t ON t.link_id=l.id WHERE l.id=n.link_id AND l.event_type_id=n.event_type_id AND l.consumed_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>n.created_at AND l.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`,
    params: [nonceId, nonceHash, now],
  };
}

/** A paid conversion is admitted only by its own still-active payment hold, which consumed the nonce. */
export function holdAdmission(holdId: string): Admission {
  return { sql: "EXISTS (SELECT 1 FROM payment_holds h WHERE h.id = ? AND h.state IN ('held', 'processing'))", params: [holdId] };
}

export function blockedProbe(binding: D1Database, email: string) {
  return binding.prepare(`SELECT ${blockedAddressSql} AS blocked`).bind(...blockedAddressValues(email));
}
