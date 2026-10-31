import { operatorBookingWhere, operatorBookingOrder, type OperatorBookingFilters } from "./operator-filters";

export type BookingExportRow = {
  bookingId: string;
  eventTypeId: string | null;
  eventTitle: string;
  state: string;
  inviteeName: string;
  inviteeEmail: string;
  hostTimezone: string;
  inviteeTimezone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  createdAt: string;
};

/** A read-only reporting projection, never a hydrated record or the install archive.
 * Deliberately omit capabilities, answers, delivery payloads, links and provider credentials.
 * Display pagination is ignored: every row matching the shared predicate is selected.
 */
export async function bookingExportRows(db: D1Database, filters: OperatorBookingFilters, now: string) {
  const { clause, values } = operatorBookingWhere(filters, now);
  const result = await db.prepare(`SELECT b.id AS bookingId, b.event_type_id AS eventTypeId, b.event_title AS eventTitle,
      b.state, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail,
      b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone,
      o.start_at AS startAt, o.end_at AS endAt, b.duration_minutes AS durationMinutes, b.created_at AS createdAt
    FROM bookings b JOIN booking_occurrences o ON ${clause}
    ORDER BY ${operatorBookingOrder(filters)}`).bind(...values).all<BookingExportRow>();
  return result.results;
}
