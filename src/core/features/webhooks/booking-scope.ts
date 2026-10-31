/** Resolve ownership at the send boundary, including deliveries queued before a host transfer. */
export function bookingWebhookScope(bookingId: "d.booking_id" | "webhook_deliveries.booking_id") {
  return `(s.scope<>'host' OR ${bookingId} IS NULL OR EXISTS(SELECT 1 FROM bookings b
    WHERE b.id=${bookingId} AND s.scope_id=COALESCE(
      (SELECT host_id FROM api_event_hosts WHERE event_type_id=b.event_type_id),
      (SELECT id FROM host_profiles WHERE singleton_key='default'))))`;
}
