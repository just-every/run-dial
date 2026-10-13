import { operatorRecipientAdmission } from "../delivery/mail";
import { reminderStatements } from "./reminder-commands";
import { createId } from "../../shared/ids";
import type { BookingEmail } from "./types";

export function cancellationOutboxStatements(binding: D1Database, bookingId: string, emails: BookingEmail[], now: string) {
  return emails.map((email) => {
    if (!email.html || email.mailTemplate?.kind !== "booking-cancellation") throw new Error("Cancellation mail is missing its shared layout template");
    const admission = operatorRecipientAdmission(email);
    return binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
    SELECT ?, 'mail_send', ? || occurrence.id || ':mail:cancel:' || ?, booking.id, occurrence.id, NULL, ?,
      'pending', 0, ?, ?, ?
    FROM bookings booking JOIN booking_occurrences occurrence ON occurrence.id = booking.current_occurrence_id
    WHERE booking.id = ? AND booking.state = 'cancelled' AND booking.cancelled_at = ? AND ${admission.sql}
    ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(createId(), `booking:${bookingId}:occurrence:`, `${email.recipientRole}:${email.to.toLowerCase()}`, JSON.stringify({ ...email, bookingState: "cancelled" }), now, now, now, bookingId, now, ...admission.params);
  });
}

export function outboxStatements(binding: D1Database, bookingId: string, occurrenceId: string, calendarPayload: Record<string, unknown> | undefined, emails: BookingEmail[], now: string) {
  return [
    ...reminderStatements(binding, bookingId, occurrenceId, emails, now),
    ...(calendarPayload ? [binding.prepare("INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at) SELECT ?, 'calendar_upsert', ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled')) ON CONFLICT(idempotency_key) DO NOTHING").bind(createId(), `booking:${bookingId}:occurrence:${occurrenceId}:calendar`, bookingId, occurrenceId, JSON.stringify(calendarPayload), now, now, now, bookingId, occurrenceId)] : []),
    ...emails.map((email) => {
      const admission = operatorRecipientAdmission(email);
      return binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, 'mail_send', ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ?) AND ${admission.sql}
      ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(), `booking:${bookingId}:occurrence:${occurrenceId}:mail:${email.recipientRole}:${email.to.toLowerCase()}`, bookingId, occurrenceId, JSON.stringify(email), now, now, now, bookingId, occurrenceId, ...admission.params);
    }),
  ];
}
