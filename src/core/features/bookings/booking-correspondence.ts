/** Copy the applied offer settings atomically; the event remains authoritative while it exists. */
export function bookingCorrespondenceStatements(binding: D1Database, bookingId: string, eventId: string, now: string) {
  return [binding.prepare(`INSERT INTO booking_correspondence (booking_id,templates_json,created_at,updated_at)
    SELECT ?,templates_json,?,? FROM event_correspondence WHERE event_type_id=? AND EXISTS (SELECT 1 FROM bookings WHERE id=?)`)
    .bind(bookingId, now, now, eventId, bookingId)];
}
