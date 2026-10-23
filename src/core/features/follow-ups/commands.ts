import { createId } from "../../shared/ids";
/** Part of the booking's own claim/reschedule batch, with no copied invitee data. */
export function followUpStatements(binding: D1Database, bookingId: string, occurrenceId: string, now: string) {
  return [binding.prepare(`INSERT INTO follow_up_runs(id,booking_id,occurrence_id,due_at,state,created_at,updated_at)
    SELECT ?,b.id,o.id,strftime('%Y-%m-%dT%H:%M:%fZ',o.end_at,'+'||s.offset_minutes||' minutes'),'pending',?,?
    FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
    JOIN event_follow_up_settings s ON s.event_type_id=b.event_type_id AND s.enabled=1
    WHERE b.id=? AND o.id=? AND b.state IN ('confirmed','rescheduled')
    ON CONFLICT(booking_id,occurrence_id) DO NOTHING`).bind(createId(), now, now, bookingId, occurrenceId)];
}
