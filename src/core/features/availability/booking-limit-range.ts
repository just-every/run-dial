import { z } from "zod";
import type { BookingLimitExclusion, BookingLimitsConfig } from "./booking-limits";
import { bookingLimitPeriods } from "./booking-limit-periods";
import { datePlus, hostDateAt } from "./timezone";

type Occurrence = { eventId: string | null; startAt: string; endAt: string };
type Limits = { host: BookingLimitsConfig; event: BookingLimitsConfig };
const scopes = ["host", "event"] as const;

/** A bounded read snapshot for a whole slot grid; final admission uses the atomic SQL predicate. */
export async function bookingLimitsForRange(
  binding: D1Database,
  limits: Limits,
  eventId: string,
  zone: string,
  firstDate: string,
  days: number,
  excludedBookingId?: string,
  inviteeEmail?: string,
): Promise<(startAt: string, endAt: string) => BookingLimitExclusion[]> {
  z.string().min(1).parse(eventId);
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(days);
  const firstPeriods = bookingLimitPeriods(firstDate, zone);
  const lastDate = datePlus(firstDate, days - 1);
  const lastPeriods = bookingLimitPeriods(lastDate, zone);
  // Week caps can reach outside the first/last candidate months.
  const from = firstPeriods.map(({ startAt }) => startAt).sort()[0];
  const until = lastPeriods.map(({ endAt }) => endAt).sort().at(-1)!;
  const email = inviteeEmail?.trim().toLowerCase();
  const gapMs = Math.max(limits.host.inviteeGapMinutes, limits.event.inviteeGapMinutes) * 60000;
  const hasCaps = scopes.some((scope) => Object.entries(limits[scope])
    .some(([key, value]) => key !== "inviteeGapMinutes" && value !== null));
  const selection = `SELECT booking.event_type_id AS eventId, occurrence.start_at AS startAt,
      occurrence.end_at AS endAt FROM booking_occurrences occurrence
    JOIN bookings booking ON booking.id = occurrence.booking_id
    WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1 AND booking.state IN ('confirmed', 'rescheduled')
      AND booking.id IS NOT ?`;
  const [counts, sameInvitee] = await Promise.all([
    hasCaps ? binding.prepare(`${selection} AND occurrence.start_at >= ? AND occurrence.start_at < ?`)
      .bind(excludedBookingId ?? null, from, until).all<Occurrence>() : undefined,
    email && gapMs > 0 ? binding.prepare(`${selection}
        AND lower(trim(booking.invitee_email)) = ?
        AND unixepoch(occurrence.start_at, 'subsec') * 1000 < ?
        AND unixepoch(occurrence.end_at, 'subsec') * 1000 > ?`)
      .bind(excludedBookingId ?? null, email, Date.parse(until) + gapMs, Date.parse(from) - gapMs)
      .all<Occurrence>() : undefined,
  ]);
  const occurrences = (counts?.results ?? []).map((row) => ({
    ...row, durationMs: Date.parse(row.endAt) - Date.parse(row.startAt),
  }));
  const inviteeOccurrences = (sameInvitee?.results ?? []).map((row) => ({
    startMs: Date.parse(row.startAt), endMs: Date.parse(row.endAt),
  }));
  const periodsByDate = new Map<string, ReturnType<typeof bookingLimitPeriods>>();
  const usageByPeriod = new Map<string, { count: number; durationMs: number }>();
  return (startAt, endAt) => {
    const start = new Date(startAt);
    const endMs = Date.parse(endAt);
    const startMs = start.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new RangeError("Booking limits require valid instants with end after start");
    }
    const day = hostDateAt(start, zone);
    if (day < firstDate || day > lastDate) throw new RangeError("Slot is outside the booking limit snapshot range");
    const exclusions: BookingLimitExclusion[] = [];
    if (hasCaps) {
      let periods = periodsByDate.get(day);
      if (!periods) {
        periods = bookingLimitPeriods(day, zone);
        periodsByDate.set(day, periods);
      }
      for (const scope of scopes) {
        for (const period of periods) {
          const countCap = limits[scope][`${period.name}Count`];
          const minuteCap = limits[scope][`${period.name}Minutes`];
          if (countCap === null && minuteCap === null) continue;
          const key = `${scope}:${period.name}:${period.startAt}`;
          let usage = usageByPeriod.get(key);
          if (!usage) {
            usage = { count: 0, durationMs: 0 };
            for (const occurrence of occurrences) {
              if (occurrence.startAt < period.startAt || occurrence.startAt >= period.endAt) continue;
              if (scope === "event" && occurrence.eventId !== eventId) continue;
              usage.count += 1;
              usage.durationMs += occurrence.durationMs;
            }
            usageByPeriod.set(key, usage);
          }
          if (countCap !== null && usage.count + 1 > countCap) exclusions.push(`${scope}_${period.name}_count`);
          if (minuteCap !== null && usage.durationMs + endMs - startMs > minuteCap * 60000) {
            exclusions.push(`${scope}_${period.name}_minutes`);
          }
        }
      }
    }
    if (inviteeOccurrences.some((occurrence) => occurrence.startMs < endMs + gapMs && occurrence.endMs > startMs - gapMs)) {
      exclusions.push("invitee_gap");
    }
    return exclusions;
  };
}
