import type { z } from "zod";
import { offeredLocations } from "../event-types/client";
import type { EventTypeInput } from "../event-types";

type GroupShape = Pick<EventTypeInput, "groupCapacity" | "durationMinutes" | "durationOptionsMinutes" | "locationType" | "locationLabel" | "locationValue" | "locations">;
const fixedLocations = new Set(["fixed_link", "in_person", "custom", "phone"]);

export function groupShapeIssue(input: GroupShape) {
  if (input.groupCapacity == null) return undefined;
  const locations = offeredLocations(input);
  if (locations.length !== 1 || !fixedLocations.has(locations[0].type)) return "Group seats require one fixed location.";
  if ((input.durationOptionsMinutes ?? [input.durationMinutes]).length !== 1) return "Group seats require one fixed duration.";
  return undefined;
}

export function validateGroupShape(input: GroupShape, context: z.RefinementCtx) {
  const issue = groupShapeIssue(input);
  if (issue) context.addIssue({ code: "custom", path: ["groupCapacity"], message: issue });
}

export const groupConfigurationMessages = {
  group_configuration_unsupported: "Group seats require one fixed location and one fixed duration.",
  group_calendar_unsupported: "Disconnect the calendar before configuring group seats. Shared-slot calendar delivery is not available yet.",
  group_payment_unsupported: "Group seats currently support free events without saved-card fees only.",
  group_approval_unsupported: "Group seats currently support immediate confirmation only.",
  group_guest_unsupported: "Each group seat must be booked by its own invitee. Additional guests are not available for group seats.",
  group_capacity_conflict: "Keep the event's active seat configuration and a capacity large enough for every occupied slot.",
} as const;
export type GroupConfigurationIssue = keyof typeof groupConfigurationMessages;

/** Readable refusals precede the matching atomic event-write triggers. */
export async function groupConfigurationIssue(binding: D1Database, input: GroupShape, eventId?: string): Promise<GroupConfigurationIssue | undefined> {
  const existing = eventId ? await binding.prepare("SELECT group_capacity AS capacity FROM event_types WHERE id=?").bind(eventId).first<{ capacity: number | null }>() : undefined;
  const capacity = input.groupCapacity === undefined ? existing?.capacity : input.groupCapacity;
  if (capacity != null) {
    if (groupShapeIssue({ ...input, groupCapacity: capacity })) return "group_configuration_unsupported";
    if (await binding.prepare("SELECT 1 FROM calendar_connections WHERE status<>'disconnected' LIMIT 1").first()) return "group_calendar_unsupported";
    if (eventId) {
      if (await binding.prepare("SELECT 1 FROM event_types WHERE id=? AND approval_required=1").bind(eventId).first()) return "group_approval_unsupported";
      if (await binding.prepare("SELECT 1 FROM event_types WHERE id=? AND guest_limit>0").bind(eventId).first()) return "group_guest_unsupported";
      if (await binding.prepare("SELECT 1 FROM event_type_prices WHERE event_type_id=? UNION ALL SELECT 1 FROM event_type_payment_terms WHERE event_type_id=? AND (deposit_kind<>'none' OR late_cancel_fee_cents>0 OR no_show_fee_cents>0) LIMIT 1").bind(eventId, eventId).first()) return "group_payment_unsupported";
    }
  }
  if (eventId && existing && capacity !== existing.capacity) {
    const active = await binding.prepare("SELECT o.start_at,o.end_at,count(*) AS seats FROM booking_occurrences o JOIN bookings b ON b.id=o.booking_id WHERE b.event_type_id=? AND b.state IN ('confirmed','rescheduled') AND o.is_current=1 AND o.blocks_time=1 GROUP BY o.start_at,o.end_at").bind(eventId).all<{ seats: number }>();
    if (active.results.length && (existing.capacity == null || capacity == null || active.results.some(slot => slot.seats > capacity))) return "group_capacity_conflict";
  }
  return undefined;
}

export function groupWriteConflict(error: unknown): GroupConfigurationIssue | undefined {
  for (let depth = 0; depth < 8 && error; depth += 1) {
    const message = error instanceof Error ? error.message : String(error);
    const issue = (Object.keys(groupConfigurationMessages) as GroupConfigurationIssue[]).find(code => message.includes(code));
    if (issue) return issue;
    error = error instanceof Error ? error.cause : undefined;
  }
  return undefined;
}
