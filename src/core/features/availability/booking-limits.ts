import { z } from "zod";
import { bookingLimitViolationsSql } from "./booking-limit-sql";
import { bookingLimitCandidate } from "./booking-limit-periods";
import { bookingLimitsForRange } from "./booking-limit-range";

const cap = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();

export const bookingLimitsSchema = z.object({
  dayCount: cap,
  weekCount: cap,
  monthCount: cap,
  dayMinutes: cap,
  weekMinutes: cap,
  monthMinutes: cap,
  inviteeGapMinutes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

export type BookingLimitsConfig = z.infer<typeof bookingLimitsSchema>;
export type BookingLimitExclusion = `${"host" | "event"}_${"day" | "week" | "month"}_${"count" | "minutes"}` | "invitee_gap";

export const emptyBookingLimits: BookingLimitsConfig = {
  dayCount: null,
  weekCount: null,
  monthCount: null,
  dayMinutes: null,
  weekMinutes: null,
  monthMinutes: null,
  inviteeGapMinutes: 0,
};

export type BookingLimitPredicate = { sql: string; params: (string | number | null)[] };

/** Limits are scoped to the native single host or one of that host's event types. */
export class BookingLimits {
  constructor(private readonly binding: D1Database) {}

  async get(scope: string): Promise<BookingLimitsConfig> {
    z.string().min(1).parse(scope);
    const row = await this.binding.prepare(
      "SELECT limits_json AS limitsJson FROM booking_limit_policies WHERE scope = ?",
    ).bind(scope).first<{ limitsJson: string }>();
    return row ? bookingLimitsSchema.parse(JSON.parse(row.limitsJson)) : { ...emptyBookingLimits };
  }

  async save(scope: string, limits: BookingLimitsConfig): Promise<BookingLimitsConfig> {
    z.string().min(1).parse(scope);
    const parsed = bookingLimitsSchema.parse(limits);
    const now = new Date().toISOString();
    await this.binding.prepare(
      `INSERT INTO booking_limit_policies (scope, limits_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET limits_json = excluded.limits_json, updated_at = excluded.updated_at`,
    ).bind(scope, JSON.stringify(parsed), now, now).run();
    return parsed;
  }

  async evaluate(
    eventId: string,
    zone: string,
    startAt: string,
    endAt: string,
    inviteeEmail?: string,
    excludedBookingId?: string,
  ): Promise<BookingLimitExclusion[]> {
    const candidate = JSON.stringify(bookingLimitCandidate(eventId, zone, startAt, endAt, inviteeEmail, excludedBookingId));
    const rows = await this.binding.prepare(bookingLimitViolationsSql)
      .bind(candidate).all<{ reason: BookingLimitExclusion }>();
    return rows.results.map(({ reason }) => reason);
  }

  /** Embed in the final INSERT/UPDATE WHERE; policy values are deliberately read in SQL. */
  async predicate(
    eventId: string,
    zone: string,
    startAt: string,
    endAt: string,
    inviteeEmail?: string,
    excludedBookingId?: string,
  ): Promise<BookingLimitPredicate> {
    return {
      sql: `NOT EXISTS (${bookingLimitViolationsSql})`,
      params: [JSON.stringify(bookingLimitCandidate(eventId, zone, startAt, endAt, inviteeEmail, excludedBookingId))],
    };
  }

  async forRange(
    eventId: string,
    zone: string,
    firstDate: string,
    days: number,
    excludedBookingId?: string,
    inviteeEmail?: string,
  ): Promise<(startAt: string, endAt: string) => BookingLimitExclusion[]> {
    const [host, event] = await Promise.all([this.get("host"), this.get(eventId)]);
    return bookingLimitsForRange(this.binding, {
      host,
      event,
    }, eventId, zone, firstDate, days, excludedBookingId, inviteeEmail);
  }
}
