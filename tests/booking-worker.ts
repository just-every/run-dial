import { BookingsRepository } from "../src/core/features/bookings/repository";
import { hashToken } from "../src/core/platform/auth/tokens";

type Bindings = { DB: D1Database };
const secret = "synthetic-booking-worker-test-secret-not-used-by-the-app";
const defaultStartAt = "2030-06-03T10:00:00.000Z";
const defaultEndAt = "2030-06-03T10:30:00.000Z";

export default {
  async fetch(request: Request, env: Bindings) {
    const repository = new BookingsRepository(env.DB);
    const url = new URL(request.url);
    if (url.pathname === "/claim" && request.method === "POST") {
      const input = await request.json<{ nonce: string; bookingId: string; startAt?: string; dayLimit?: number }>();
      const startAt = input.startAt ?? defaultStartAt;
      const endAt = input.startAt ? new Date(Date.parse(startAt) + 30 * 60000).toISOString() : defaultEndAt;
      const nonceHash = await hashToken(input.nonce, secret);
      const now = new Date().toISOString();
      const nonceId = await repository.createNonce({
        nonceHash,
        purpose: "confirm",
        eventTypeId: "event-test",
        selection: { startAt, endAt, inviteeTimezone: "UTC" },
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        now,
      }).catch(() => undefined);
      if (!nonceId) return Response.json({ result: "duplicate_nonce" });
      const result = await repository.claim({
        bookingId: input.bookingId,
        occurrenceId: `occurrence-${input.bookingId}`,
        nonceId,
        nonceHash,
        payloadHash: `payload-${input.nonce}`,
        manageTokenId: `manage-token-${input.bookingId}`,
        manageTokenHash: await hashToken(`manage-${input.nonce}`, secret),
        manageTokenExpiresAt: "2030-09-01T10:00:00.000Z",
        event: { ...event(), hostDayBookingLimit: input.dayLimit ?? null },
        invitee: { name: "D1 Invitee", email: `${input.bookingId}@example.test`, answers: { q_goal: "review" } },
        selection: { startAt, endAt, inviteeTimezone: "UTC" },
        hostTimezone: "UTC",
        hostDate: startAt.slice(0, 10),
        occupiedStartAt: startAt,
        occupiedEndAt: endAt,
        now,
        calendarPayload: { eventTitle: "D1 claim", startAt, endAt, hostTimezone: "UTC", invitee: { email: `${input.bookingId}@example.test` }, location: "https://example.test/call", locationType: "fixed_link", occurrenceId: `occurrence-${input.bookingId}` },
        emails: [],
      });
      return Response.json({ result });
    }
    if (url.pathname === "/status") {
      const count = await env.DB.prepare("SELECT count(*) AS count FROM bookings WHERE state = 'confirmed'").first<{ count: number }>();
      const outbox = await env.DB.prepare("SELECT count(*) AS count FROM delivery_outbox WHERE kind = 'calendar_upsert'").first<{ count: number }>();
      return Response.json({ confirmed: count?.count ?? 0, calendarCommands: outbox?.count ?? 0 });
    }
    if (url.pathname === "/reschedule" && request.method === "POST") {
      const bookingId = url.searchParams.get("bookingId") ?? "booking-0";
      const booking = await repository.getById(bookingId);
      if (!booking) return new Response("Missing booked fixture", { status: 500 });
      const nonce = "reschedule-nonce";
      const nonceHash = await hashToken(nonce, secret);
      const now = new Date().toISOString();
      const nonceId = await repository.createNonce({ nonceHash, purpose: "reschedule", eventTypeId: "event-test", bookingId: booking.id, selection: { startAt: "2030-06-03T12:00:00.000Z", endAt: "2030-06-03T12:30:00.000Z", inviteeTimezone: "UTC" }, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), now });
      const result = await repository.reschedule({
        booking, nonceId, nonceHash, payloadHash: "reschedule-payload",
        selection: { startAt: "2030-06-03T12:00:00.000Z", endAt: "2030-06-03T12:30:00.000Z", inviteeTimezone: "UTC" },
        hostDate: "2030-06-03", occupiedStartAt: "2030-06-03T12:00:00.000Z", occupiedEndAt: "2030-06-03T12:30:00.000Z", now,
        calendarPayload: { eventTitle: "D1 claim", startAt: "2030-06-03T12:00:00.000Z", endAt: "2030-06-03T12:30:00.000Z", hostTimezone: "UTC", invitee: { email: booking.inviteeEmail }, location: booking.locationValue, locationType: booking.locationType }, emails: [],
      });
      return Response.json({ result, booking: await repository.getById(bookingId) });
    }
    if (url.pathname === "/cancel" && request.method === "POST") {
      const bookingId = url.searchParams.get("bookingId") ?? "booking-0";
      const booking = await repository.getById(bookingId);
      if (!booking) return new Response("Missing booked fixture", { status: 500 });
      const result = await repository.cancel(booking, { type: "invitee" }, "schedule changed", new Date().toISOString(), []);
      const claims = await repository.listInternalClaims("2030-06-03T00:00:00.000Z", "2030-06-04T00:00:00.000Z");
      const current = await env.DB.prepare("SELECT id, state FROM booking_occurrences WHERE booking_id = ? AND is_current = 1").bind(bookingId).all<{ id: string; state: string }>();
      const cancellation = await env.DB.prepare("SELECT occurrence_id AS occurrenceId FROM delivery_outbox WHERE booking_id = ? AND kind = 'calendar_cancel'").bind(bookingId).first<{ occurrenceId: string }>();
      const pendingUpserts = await env.DB.prepare("SELECT count(*) AS count FROM delivery_outbox WHERE booking_id = ? AND kind = 'calendar_upsert' AND state = 'pending'").bind(bookingId).first<{ count: number }>();
      return Response.json({ state: result?.state, currentStart: result?.occurrence.startAt, claims: claims.length, current: current.results, cancellationOccurrenceId: cancellation?.occurrenceId, pendingUpserts: pendingUpserts?.count ?? 0 });
    }
    return new Response("Not found", { status: 404 });
  },
};

function event() {
  return {
    id: "event-test", status: "published" as const, slug: "d1-claim", title: "D1 claim", description: "Transaction test", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link" as const, locationLabel: "Private call", locationValue: "https://example.test/call", listed: true, alternativeRequestsEnabled: false,
    slotIncrementMinutes: 15 as const, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null,
    questions: [{ key: "q_goal", kind: "single_choice" as const, label: "Goal", required: true, options: [{ value: "review", label: "Review" }] }], availability: [{ weekday: 1, startMinute: 600, endMinute: 660 }], createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
  };
}
