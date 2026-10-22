import { defineErasure, type Declaration, type Edge } from "../../../modules/erasure/index.mjs";

const child = (table: string, from: string, column: string): Edge => ({ table, from, on: { [column]: "id" } });
const mailEdges: Edge[] = [
  child("delivery_attempts", "delivery_outbox", "outbox_id"),
  child("operator_mail_invocations", "delivery_outbox", "outbox_id"),
  { table: "rer_mail_development_outbox", from: "delivery_outbox", where: "json_extract(message, '$.deliveryId')=COALESCE(json_extract(?, '$.providerIdempotencyKey'), ?)", params: ["payload_json", "idempotency_key"] },
  { table: "base_mail_dispatch", from: "delivery_outbox", where: "delivery_id = COALESCE(json_extract(?, '$.providerIdempotencyKey'), ?)", params: ["payload_json", "idempotency_key"] },
  { table: "provider_webhook_events", from: "delivery_outbox", where: "delivery_id = COALESCE(json_extract(?, '$.providerIdempotencyKey'), ?) OR (delivery_id IS NULL AND provider IN ('sendgrid','resend'))", params: ["payload_json", "idempotency_key"] },
];
export function bookingGraph(statements?: Declaration["statements"]) {
  return defineErasure({ entity: "booking", root: { table: "bookings" }, statements,
    edges: [
      ...["booking_reschedule_requests", "booking_request_history", "booking_answers", "booking_attendance", "booking_calendar_conflicts", "booking_correspondence", "booking_history", "booking_manage_tokens", "booking_nonces", "booking_occurrences", "booking_presentation", "calendar_deletion_probes", "operator_creation_receipts", "ext_custom_field_values", "move_in_differences", "booking_payments", "payment_holds", "booking_payment_terms", "payment_link_tokens", "booking_card_consents", "payment_movements"].map(table => child(table, "bookings", "booking_id")),
      // The erasure's own provider cleanup command (calendar_cancel without an occurrence) keeps only the
      // booking lookup key; the helper's completion pass must not treat it as a late copy and delete it.
      { table: "delivery_outbox", from: "bookings", where: "booking_id=? AND NOT (kind='calendar_cancel' AND occurrence_id IS NULL)", params: ["id"] },
      { table: "booking_nonces", from: "bookings", on: { result_booking_id: "id" } },
      ...mailEdges,
      { table: "move_in_targets", from: "bookings", where: "kind='booking' AND id=?", params: ["id"] },
    ],
    redact: [{ table: "availability_requests", from: "bookings", on: { booking_id: "id" }, set: { booking_id: null }, reason: "An unrelated request remains independently usable." },
      { table: "booking_links", from:"bookings",on:{consumed_booking_id:"id"},set:{consumed_booking_id:null},reason:"Keep the used state without retaining the erased booking association." }],
  });
}
export function requestGraph(statements?: Declaration["statements"]) {
  return defineErasure({ entity: "availability-request", root: { table: "availability_requests" }, statements,
    edges: [
      ...["availability_request_windows", "availability_request_review_nonces", "ext_custom_field_values", "delivery_outbox"].map(table => child(table, "availability_requests", "request_id")),
      ...mailEdges,
    ],
  });
}

export const mailGraph = () => defineErasure({entity:"mail",root:{table:"delivery_outbox"},edges:mailEdges});
