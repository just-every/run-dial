import { createId, nowIso } from "../../shared/ids";
import type { ErasureStatement } from "./booking-statements";

/** Retain only the booking lookup key when a managed event appears after erasure. */
export function calendarErasureRepair(id: string, source: string, newerThan?: string): ErasureStatement[] {
  const now = nowIso(), jobId = createId();
  return [
    { sql: `INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, 'calendar_cancel', ?, booking_id, NULL, NULL, '{"erasure":true}', 'pending', 0, ?, ?, ? FROM erased_calendar_targets
      WHERE booking_id = ? AND archive_historical = 0 ${newerThan === undefined ? "" : "AND (completed_at IS NULL OR completed_at < ?)"}
      ON CONFLICT(idempotency_key) DO NOTHING`, params: [jobId, `erasure:${id}:${source}`, now, now, now, id, ...(newerThan === undefined ? [] : [newerThan])] },
    { sql: "UPDATE erased_calendar_targets SET completed_at = NULL, last_error_code = NULL WHERE booking_id = ? AND archive_historical = 0 AND EXISTS (SELECT 1 FROM delivery_outbox WHERE id = ?)", params: [id, jobId] },
  ];
}
