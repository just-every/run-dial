import type { DeliveryOutboxRecord } from "../delivery";
import type { ErasureStatement } from "./booking-statements";

/** Only the latest cleanup command and its current attempt own the erasure status.
 * A later command represents a provider effect the earlier lookup may not have seen,
 * even when that later command failed. Historical failures cannot undo its recovery. */
export function calendarCleanupOutcome(record: DeliveryOutboxRecord, completedAt: string | null, errorCode: string | null): ErasureStatement[] {
  if (record.kind !== "calendar_cancel" || !record.bookingId || record.occurrenceId) return [];
  return [{
    sql: `UPDATE erased_calendar_targets SET completed_at = ?, last_error_code = ?
      WHERE booking_id = ? AND archive_historical = 0
        AND EXISTS (SELECT 1 FROM delivery_outbox current
          WHERE current.id = ? AND current.booking_id = erased_calendar_targets.booking_id
            AND current.state = 'processing' AND current.attempts = ?
            AND NOT EXISTS (SELECT 1 FROM delivery_outbox newer
              WHERE newer.booking_id = current.booking_id AND newer.kind = 'calendar_cancel'
                AND newer.occurrence_id IS NULL AND newer.rowid > current.rowid))`,
    params: [completedAt, errorCode, record.bookingId, record.id, record.attempts],
  }];
}
