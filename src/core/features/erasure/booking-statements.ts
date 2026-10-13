import { createId, nowIso } from "../../shared/ids";
export type ErasureStatement = { sql: string; params: unknown[] };

/** These run before the graph deletes. The shared helper's hook runs afterwards. */
export function bookingErasureCapture(id: string, operatorId: string): ErasureStatement[] {
  const now = nowIso();
  return [
    { sql: "INSERT OR IGNORE INTO operator_creation_tombstones(key_hash,operator_id,created_at) SELECT key_hash,operator_id,created_at FROM operator_creation_receipts WHERE booking_id=?", params: [id] },
    { sql: "INSERT INTO anonymized_audit (id, entity_kind, action, actor_type, actor_id, happened_at, erased_at) SELECT lower(hex(randomblob(16))), 'booking', action, actor_type, CASE WHEN actor_type = 'operator' THEN actor_id ELSE NULL END, created_at, ? FROM booking_history WHERE booking_id = ?", params: [now, id] },
    { sql: "INSERT INTO anonymized_audit (id, entity_kind, action, actor_type, actor_id, happened_at, erased_at) SELECT ?, 'booking', 'erased', 'operator', ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)", params: [createId(), operatorId, now, now, id] },
    { sql: `INSERT INTO erased_calendar_targets (booking_id, created_at, receipt_id)
      SELECT b.id, ?, (SELECT receipt_id FROM person_erasure_locks WHERE email=b.invitee_email_folded) FROM bookings b WHERE b.id = ? AND b.calendar_required = 1 AND (b.imported = 0 OR b.calendar_provider_event_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM delivery_outbox d WHERE d.booking_id = b.id AND d.kind = 'calendar_upsert'
          AND CASE WHEN json_valid(d.payload_json) THEN json_extract(d.payload_json, '$.archiveHistorical') END IS NOT 1))
      ON CONFLICT(booking_id) DO NOTHING`, params: [now, id] },
  ];
}
export function bookingErasureFinish(id: string): ErasureStatement[] {
  const now = nowIso();
  return [{ sql: `INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
    SELECT ?, 'calendar_cancel', ?, booking_id, NULL, NULL, '{"erasure":true}', 'pending', 0, ?, ?, ? FROM erased_calendar_targets
    WHERE booking_id = ? AND archive_historical = 0 AND completed_at IS NULL ON CONFLICT(idempotency_key) DO NOTHING`,
    params: [createId(), `erasure:${id}:calendar-cancel`, now, now, now, id] }];
}
