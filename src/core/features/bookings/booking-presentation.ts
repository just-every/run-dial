import type { BookingClaim } from "./types";

/** Persist the location zone separately from the visitor observation; hosts have no browser observation. */
export function bookingPresentationStatements(binding: D1Database, input: Pick<BookingClaim, "bookingId" | "event" | "selection" | "now">, inviteeAction: boolean, requestId?: string) {
  const locked = input.event.bookingPolicy?.lockedTimezone;
  return locked ? [binding.prepare(`INSERT INTO booking_presentation (booking_id,locked_timezone,browser_timezone,created_at,updated_at)
    SELECT ?,?,CASE WHEN ? THEN ? ELSE (SELECT browser_timezone FROM availability_requests WHERE id=?) END,?,? WHERE EXISTS (SELECT 1 FROM bookings WHERE id=?)`)
    .bind(input.bookingId, locked, inviteeAction ? 1 : 0, input.selection.inviteeTimezone, requestId ?? null, input.now, input.now, input.bookingId)] : [];
}
