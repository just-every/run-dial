import type { BusyInterval, InternalClaim } from "./engine";
import { BookingLimits } from "./booking-limits";

/** Database reads required by availability; calendar reads stay in the adapter. */
export class AvailabilityRepository {
  constructor(private readonly binding: D1Database) {}
  async limitsForRange(eventId: string, zone: string, date: string, days: number, excludedBookingId?: string, inviteeEmail?: string) {
    if (excludedBookingId && !inviteeEmail) inviteeEmail = (await this.binding.prepare("SELECT invitee_email AS email FROM bookings WHERE id=?").bind(excludedBookingId).first<{ email: string }>())?.email;
    return new BookingLimits(this.binding).forRange(eventId, zone, date, days, excludedBookingId, inviteeEmail);
  }

  async listInternalClaims(startAt: string, endAt: string, excludedBookingId?: string, capHostDates: string[] = []): Promise<InternalClaim[]> {
    // Persisted host dates also govern the atomic cap after profile-zone changes.
    const capDates = [...new Set(capHostDates)];
    const dateClause = capDates.length ? ` OR occurrence.host_date IN (${capDates.map(() => "?").join(", ")})` : "";
    const result = await this.binding
      .prepare(
        `SELECT occurrence.occupied_start_at AS startAt, occurrence.occupied_end_at AS endAt, occurrence.host_date AS hostDate,
                occurrence.start_at AS bookingStartAt, occurrence.end_at AS bookingEndAt
         FROM booking_occurrences occurrence
         JOIN bookings booking ON booking.id = occurrence.booking_id
         WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1
           AND booking.state IN ('confirmed', 'rescheduled')
           AND ((occurrence.occupied_start_at < ?
           AND occurrence.occupied_end_at > ?)${dateClause})
           AND (? IS NULL OR booking.id <> ?)`,
      )
      .bind(endAt, startAt, ...capDates, excludedBookingId ?? null, excludedBookingId ?? null)
      .all<InternalClaim>();
    return result.results;
  }

  /** Where Dial's own managed events sat when a busy read was observed: each booking's last confirmed placement (an
   * upsert the provider accepted) not yet confirmed removed or moved by then. A destination calendar that is also a
   * conflict calendar returns these events as busy time; they are Dial bookings, which internal claims already cover. */
  async listOwnCalendarEvents(startAt: string, endAt: string, observedAt: string): Promise<BusyInterval[]> {
    const result = await this.binding
      .prepare(
        `SELECT DISTINCT occurrence.start_at AS startAt, occurrence.end_at AS endAt
         FROM booking_occurrences occurrence
         JOIN delivery_outbox placed ON placed.occurrence_id = occurrence.id AND placed.kind = 'calendar_upsert'
         JOIN delivery_attempts placement ON placement.outbox_id = placed.id AND placement.outcome = 'succeeded'
           AND placement.provider_message_id IS NOT NULL AND placement.attempted_at <= ?
         WHERE occurrence.start_at < ? AND occurrence.end_at > ?
           AND NOT EXISTS (
             SELECT 1 FROM delivery_outbox later JOIN delivery_attempts moved ON moved.outbox_id = later.id
             WHERE later.booking_id = occurrence.booking_id AND later.kind = 'calendar_upsert' AND later.occurrence_id <> occurrence.id
               AND moved.outcome = 'succeeded' AND moved.provider_message_id IS NOT NULL
               AND moved.attempted_at > placement.attempted_at AND moved.attempted_at <= ?)
           AND NOT EXISTS (
             SELECT 1 FROM delivery_outbox removal JOIN delivery_attempts removed ON removed.outbox_id = removal.id
             WHERE removal.booking_id = occurrence.booking_id AND removal.kind = 'calendar_cancel' AND removed.outcome = 'succeeded'
               AND removed.attempted_at >= placement.attempted_at AND removed.attempted_at <= ?)`,
      )
      .bind(observedAt, endAt, startAt, observedAt, observedAt)
      .all<BusyInterval>();
    return result.results;
  }
}
