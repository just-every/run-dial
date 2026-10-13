import { createId } from "../../shared/ids";
import type { BookingRecord } from "./types";

/** The winning restoration and its pending delivery state commit together. */
export async function restoreCalendarConflict(binding: D1Database, booking: BookingRecord, conflictId: string, now: string) {
  const jobId = createId();
  const payload = { bookingId: booking.id, occurrenceId: booking.occurrence.id, icalUid: booking.icalUid,
    eventTitle: booking.eventTitle, startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt,
    hostTimezone: booking.hostTimezone, invitee: { name: booking.inviteeName, email: booking.inviteeEmail },
    location: booking.locationValue, locationType: booking.locationType };
  const result = await binding.batch([
    binding.prepare(`UPDATE booking_calendar_conflicts SET state = 'restored', updated_at = ?
      WHERE id = ? AND booking_id = ? AND occurrence_id = ? AND state = 'open'
      AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled'))`)
      .bind(now, conflictId, booking.id, booking.occurrence.id, booking.id, booking.occurrence.id),
    binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, 'calendar_upsert', ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM booking_calendar_conflicts WHERE id = ? AND booking_id = ? AND occurrence_id = ? AND state = 'restored' AND updated_at = ?)
      AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled'))
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(jobId, `booking:${booking.id}:occurrence:${booking.occurrence.id}:calendar-restore:${conflictId}`, booking.id, booking.occurrence.id,
        JSON.stringify(payload), now, now, now, conflictId, booking.id, booking.occurrence.id, now, booking.id, booking.occurrence.id),
    binding.prepare("UPDATE bookings SET calendar_state = 'pending', updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND EXISTS (SELECT 1 FROM delivery_outbox WHERE id = ?)")
      .bind(now, booking.id, booking.occurrence.id, jobId),
  ]);
  return result[0].meta.changes === 1;
}

export function closeCalendarConflicts(binding: D1Database, bookingId: string, now: string) {
  return binding.prepare(`UPDATE booking_calendar_conflicts SET state = 'cancelled', updated_at = ? WHERE booking_id = ? AND state = 'open'
    AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND state = 'cancelled' AND cancelled_at = ?)`)
    .bind(now, bookingId, bookingId, now);
}
