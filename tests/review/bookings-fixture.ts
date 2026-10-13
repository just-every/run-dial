import { hostDateAt } from "../../src/core/features/availability/timezone";
import type { AppBindings } from "../../src/core/app/bindings";
import type { AppServices } from "../../src/core/app/services";
const bookingId = (index: number) => `qa-booking-${String(index).padStart(15, "0")}`;
const fixtureIds = Array.from({ length: 500 }, (_, index) => bookingId(index + 1));
export async function bulkBookingsFixture(request: Request, env: AppBindings, services: AppServices) {
  if (request.method !== "POST" || request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (!await services.operators.authenticate(request)) return new Response(null, { status: 401 });
  const input = await request.json<{ bookingId?: string; clear?: boolean }>();
  if (input.clear === true) {
    await env.DB.prepare("DELETE FROM bookings WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(fixtureIds)).run();
    return new Response(null, { status: 204 });
  }
  if (typeof input.bookingId !== "string" || input.bookingId.length !== 26) return new Response(null, { status: 400 });
  const count = await env.DB.prepare("SELECT count(*) AS total FROM bookings").first<{ total: number }>();
  const source = await env.DB.prepare("SELECT b.duration_minutes, b.host_timezone, b.created_at, o.start_at, o.end_at, o.occupied_start_at, o.occupied_end_at FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ? AND b.state IN ('confirmed', 'rescheduled') AND o.is_current = 1").bind(input.bookingId).first<{ duration_minutes: number; host_timezone: string; created_at: string; start_at: string; end_at: string; occupied_start_at: string; occupied_end_at: string }>();
  if (!source || count?.total !== 1) return new Response(null, { status: 409 });
  const shift = (value: string, index: number) => new Date(Date.parse(value) + index * source.duration_minutes * 60000).toISOString();
  const records = fixtureIds.map((id, position) => {
    const index = position + 1, start = shift(source.start_at, index);
    return { id, occurrence: `qa-occur-${String(index).padStart(17, "0")}`, start, end: shift(source.end_at, index), occupiedStart: shift(source.occupied_start_at, index), occupiedEnd: shift(source.occupied_end_at, index), hostDate: hostDateAt(new Date(start), source.host_timezone), created: new Date(Date.parse(source.created_at) + index * 1000).toISOString() };
  });
  const rows = JSON.stringify(records);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO bookings (id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value, invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_state, meeting_state, meeting_url, current_occurrence_id, created_at, updated_at)
      SELECT json_extract(j.value,'$.id'), b.event_type_id, b.event_slug, b.event_title, b.duration_minutes, b.location_type, b.location_label, b.location_value, b.invitee_name, b.invitee_email, b.host_timezone, b.invitee_timezone, b.state, json_extract(j.value,'$.id') || '@dial.test', b.calendar_state, b.meeting_state, b.meeting_url, json_extract(j.value,'$.occurrence'), json_extract(j.value,'$.created'), json_extract(j.value,'$.created') FROM bookings b, json_each(?) j WHERE b.id = ?`).bind(rows, input.bookingId),
    env.DB.prepare(`INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at)
      SELECT json_extract(value,'$.occurrence'), json_extract(value,'$.id'), 0, json_extract(value,'$.start'), json_extract(value,'$.end'), json_extract(value,'$.occupiedStart'), json_extract(value,'$.occupiedEnd'), json_extract(value,'$.hostDate'), 'current', 1, json_extract(value,'$.created') FROM json_each(?)`).bind(rows),
  ]);
  return Response.json({ count: 501, newestBookingId: fixtureIds.at(-1) });
}
