import type { DeliveryOutboxRecord } from "./repository";

/** The persisted calendar result, never connection configuration, authorizes suppression. */
export class ConfirmationDeliveryRepository {
  constructor(private readonly binding: D1Database) {}

  async calendar(record: DeliveryOutboxRecord) {
    return this.binding.prepare(`SELECT CASE WHEN b.calendar_required=0 THEN 'not_required' ELSE b.calendar_state END AS state,
      (SELECT d.id FROM delivery_outbox d WHERE d.booking_id=b.id AND d.occurrence_id=b.current_occurrence_id
        AND d.kind='calendar_upsert' AND d.state='pending' ORDER BY d.created_at,d.id LIMIT 1) AS outboxId
      FROM bookings b WHERE b.id=? AND b.current_occurrence_id=? AND b.state IN ('confirmed','rescheduled')`)
      .bind(record.bookingId, record.occurrenceId).first<{ state: string; outboxId: string | null }>();
  }

  async suppress(record: DeliveryOutboxRecord) {
    await this.binding.prepare(`UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.confirmationSuppressed',json('true'))
      WHERE id=? AND state='processing' AND attempts=?`).bind(record.id,record.attempts).run();
  }
}
