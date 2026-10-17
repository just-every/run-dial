import { z } from "zod";
import { defaultInheritedChangePolicyWindows, inheritedChangePolicyWindowsSchema, type InheritedChangePolicyWindows } from "../../shared/change-policy";
import { nextEventTimestampSql } from "../../shared/event-revision";
import { eventBookingPolicySchema, type EventBookingPolicy } from "../../shared/booking-policy";

const policyColumns = `policy.locked_timezone AS lockedTimezone,
  policy.reschedule_cutoff_minutes AS rescheduleCutoffMinutes,
  policy.cancellation_cutoff_minutes AS cancellationCutoffMinutes,
  policy.reschedule_cap AS maxInviteeReschedules`;

/** Authorization belongs to the calling route; nonexistent events never gain a policy. */
export class EventBookingPolicyRepository {
  constructor(private readonly binding: D1Database) {}

  async read(eventTypeId: string): Promise<EventBookingPolicy | null> {
    const row = await this.binding.prepare(`SELECT ${policyColumns}
      FROM event_types event LEFT JOIN event_booking_policies policy ON policy.event_type_id = event.id
      WHERE event.id = ?`).bind(eventTypeId).first<EventBookingPolicy>();
    return row ? eventBookingPolicySchema.parse(row) : null;
  }

  async save(eventTypeId: string, input: EventBookingPolicy, now: string): Promise<EventBookingPolicy | null> {
    const policy = eventBookingPolicySchema.parse(input);
    z.iso.datetime({ offset: true }).parse(now);
    const [result] = await this.binding.batch([
      this.binding.prepare(`INSERT INTO event_booking_policies
      (event_type_id, locked_timezone, reschedule_cutoff_minutes, cancellation_cutoff_minutes, reschedule_cap, created_at, updated_at)
      SELECT id, ?, ?, ?, ?, ?, ? FROM event_types WHERE id = ?
      ON CONFLICT(event_type_id) DO UPDATE SET locked_timezone = excluded.locked_timezone,
        reschedule_cutoff_minutes = excluded.reschedule_cutoff_minutes,
        cancellation_cutoff_minutes = excluded.cancellation_cutoff_minutes,
        reschedule_cap = excluded.reschedule_cap, updated_at = excluded.updated_at`)
      .bind(policy.lockedTimezone, policy.rescheduleCutoffMinutes, policy.cancellationCutoffMinutes,
        policy.maxInviteeReschedules, now, now, eventTypeId),
      this.binding.prepare(`UPDATE event_types SET updated_at = ${nextEventTimestampSql} WHERE id = ?`)
        .bind(now, eventTypeId),
    ]);
    return result.meta.changes > 0 ? policy : null;
  }

  async successfulInviteeReschedules(bookingId: string): Promise<number> {
    const row = await this.binding.prepare(`SELECT count(*) AS count FROM booking_history
      WHERE booking_id = ? AND actor_type = 'invitee' AND action = 'rescheduled'`)
      .bind(bookingId).first<{ count: number }>();
    if (!row) throw new Error("Booking history count was not returned.");
    return z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(row.count);
  }
}

/**
 * Append `AND ${predicate.sql}` and bind its params in the mutation that claims
 * the change, before replacing the current occurrence or writing its history.
 * D1 then reads the latest policy, current start and successful invitee history
 * in the same transaction. Operator/BOOK-014 bypass is the caller's decision.
 */
export function inviteeChangePolicyPredicate(input: {
  bookingId: string;
  action: "reschedule" | "cancel";
  now: string;
  inherited?: InheritedChangePolicyWindows;
}): { sql: string; params: (string | number)[] } {
  const inherited = inheritedChangePolicyWindowsSchema.parse(input.inherited ?? defaultInheritedChangePolicyWindows);
  z.iso.datetime({ offset: true }).parse(input.now);
  const rescheduling = input.action === "reschedule";
  const cutoffColumn = rescheduling ? "reschedule_cutoff_minutes" : "cancellation_cutoff_minutes";
  const cutoff = rescheduling ? inherited.rescheduleCutoffMinutes : inherited.cancellationCutoffMinutes;
  return {
    sql: `(EXISTS(SELECT 1 FROM booking_reschedule_requests request WHERE request.booking_id=? AND request.state='open' AND request.archive_historical=0 AND request.expires_at>?) OR EXISTS (SELECT 1 FROM bookings policy_booking
      JOIN booking_occurrences policy_occurrence ON policy_occurrence.id = policy_booking.current_occurrence_id
        AND policy_occurrence.booking_id = policy_booking.id AND policy_occurrence.is_current = 1
      LEFT JOIN event_booking_policies policy ON policy.event_type_id = policy_booking.event_type_id
      WHERE policy_booking.id = ? AND policy_booking.state IN ('confirmed', 'rescheduled')
        AND julianday(?) < julianday(policy_occurrence.start_at, '-' || COALESCE(policy.${cutoffColumn}, ?) || ' minutes')
        ${rescheduling ? `AND (policy.reschedule_cap IS NULL OR (
          SELECT count(*) FROM booking_history policy_history WHERE policy_history.booking_id = policy_booking.id
            AND policy_history.actor_type = 'invitee' AND policy_history.action = 'rescheduled'
        ) < policy.reschedule_cap)` : ""}))`,
    params: [input.bookingId, input.now, input.bookingId, input.now, cutoff],
  };
}
