import type { BookingClaim } from "./types";

/** Persist the location zone separately from the visitor observation; hosts have no browser observation. */
export function bookingPresentationStatements(binding: D1Database, input: Pick<BookingClaim, "bookingId" | "event" | "selection" | "now">, inviteeAction: boolean) {
  const locked = input.event.bookingPolicy?.lockedTimezone;
  return locked ? [binding.prepare(`INSERT INTO booking_presentation (booking_id,locked_timezone,browser_timezone,created_at,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM bookings WHERE id=?)`)
    .bind(input.bookingId, locked, inviteeAction ? input.selection.inviteeTimezone : null, input.now, input.now, input.bookingId)] : [];
}
