import { createId, nowIso } from "../../shared/ids";

/** New retry commands retain ambiguous mail effect identity and never reopen completed work. */
export class DeliveryRecovery {
  constructor(private readonly db: D1Database) {}

  async list(bookingId: string) {
    return (await this.db.prepare("SELECT d.id, d.kind, d.state, d.attempts, d.last_error_code AS lastErrorCode, d.next_attempt_at AS nextAttemptAt, r.id AS retryId, r.state AS retryState FROM delivery_outbox d LEFT JOIN delivery_outbox r ON r.booking_id = d.booking_id AND r.idempotency_key = 'retry:' || d.id WHERE d.booking_id = ? AND (d.last_error_code IS NULL OR d.last_error_code NOT IN ('superseded_occurrence', 'booking_cancelled')) ORDER BY d.created_at, d.id").bind(bookingId).all<{ id: string; kind: string; state: string; attempts: number; lastErrorCode: string | null; nextAttemptAt: string; retryId: string | null; retryState: string | null }>()).results;
  }

  async retry(bookingId: string, deliveryId: string) {
    const now = nowIso();
    const id = createId();
    const key = `retry:${deliveryId}`;
    const inserted = await this.db.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, kind, ?, booking_id, occurrence_id, request_id, CASE WHEN kind = 'calendar_upsert' THEN json_set(payload_json, '$.conferencePollAttempt', 0, '$.conferencePollCycle', ?) WHEN kind IN ('mail_send', 'reminder') THEN CASE WHEN last_error_code IN ('bounced', 'permanent_delivery_failure') THEN json_remove(payload_json, '$.providerIdempotencyKey', '$.wireMail') ELSE json_set(payload_json, '$.providerIdempotencyKey', COALESCE(json_extract(payload_json, '$.providerIdempotencyKey'), idempotency_key)) END ELSE payload_json END, 'pending', 0, ?, ?, ? FROM delivery_outbox d
      WHERE d.id = ? AND d.booking_id = ? AND d.state = 'failed' AND d.last_error_code IS NOT 'operator_removed' AND d.last_error_code IS NOT 'operator_mail_outcome_unknown' AND d.last_error_code IS NOT 'mail_outcome_unknown'
        AND json_extract(d.payload_json, '$.operatorAccessRevoked') IS NOT 1
        AND json_extract(d.payload_json, '$.archiveHistorical') IS NOT 1
      AND ((d.occurrence_id IS NULL AND EXISTS (SELECT 1 FROM erased_calendar_targets e WHERE e.booking_id = d.booking_id AND e.archive_historical = 0 AND e.completed_at IS NULL))
        OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = d.booking_id AND b.current_occurrence_id = d.occurrence_id
          AND ((d.kind = 'calendar_cancel' AND b.state = 'cancelled') OR (d.kind = 'mail_send' AND b.state = 'cancelled' AND json_extract(d.payload_json, '$.bookingState') = 'cancelled') OR (d.kind <> 'calendar_cancel' AND b.state IN ('confirmed', 'rescheduled')))))
      ON CONFLICT(idempotency_key) DO NOTHING`).bind(id, key, id, now, now, now, deliveryId, bookingId).run();
    if (inserted.meta.changes === 1) {
      await this.db.prepare("UPDATE bookings SET calendar_state = 'pending' WHERE id = ? AND EXISTS (SELECT 1 FROM delivery_outbox WHERE id = ? AND kind IN ('calendar_upsert', 'calendar_cancel'))").bind(bookingId, id).run();
      return { id, state: "pending" as const };
    }
    return this.db.prepare("SELECT id, state FROM delivery_outbox WHERE booking_id = ? AND idempotency_key = ?").bind(bookingId, key).first<{ id: string; state: string }>();
  }
}
