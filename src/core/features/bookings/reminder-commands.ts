import { operatorRecipientAdmission } from "../delivery/mail";
import { createId } from "../../shared/ids";
import type { BookingEmail } from "./types";

/** Offsets already elapsed at claim time are never scheduled. Commands hold no answer copy. */
export function reminderStatements(binding: D1Database, bookingId: string, occurrenceId: string, emails: BookingEmail[], now: string) {
  return emails.flatMap((email) => {
    const admission = operatorRecipientAdmission(email);
    return [1440, 60].map((offsetMinutes) => binding.prepare(`
    INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
    SELECT ?, 'reminder', ?, b.id, o.id, NULL, ?, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', o.start_at, ?), ?, ?
    FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id
    WHERE b.id = ? AND o.id = ? AND b.state IN ('confirmed', 'rescheduled')
      AND strftime('%Y-%m-%dT%H:%M:%fZ', o.start_at, ?) > ? AND ${admission.sql}
    ON CONFLICT(idempotency_key) DO NOTHING
  `).bind(createId(), `booking:${bookingId}:occurrence:${occurrenceId}:reminder:${offsetMinutes}:${email.recipientRole}:${email.to.toLowerCase()}`,
    JSON.stringify({ to: email.to, recipientRole: email.recipientRole, ...(email.operatorAccess ? { operatorAccess: email.operatorAccess } : {}), ...(email.recipientRole === "invitee" && email.manageUrl ? { manageUrl: email.manageUrl } : {}) }),
    `-${offsetMinutes} minutes`, now, now, bookingId, occurrenceId, `-${offsetMinutes} minutes`, now, ...admission.params));
  });
}
