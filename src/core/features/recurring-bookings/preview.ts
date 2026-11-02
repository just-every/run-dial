import { AvailabilityRepository, AvailabilityService, datePlus, hostDateForInstant, wallClockInstants, zonedParts } from "../availability";
import type { EventTypesService } from "../event-types";
import { offeredLocations } from "../event-types/client";
import type { HostProfileService } from "../host-profile";
import type { RecurringPreviewInput } from "./input";

type PreviewDependencies = { eventTypes: EventTypesService; hostProfile: HostProfileService };
type Time = { startAt: string; endAt: string };
const fixedLocations = new Set(["fixed_link", "phone", "in_person", "custom"]);

/** Advisory only: no booking command, provider capability or persistent state is used. */
export async function previewWeeklySeries(db: D1Database, services: PreviewDependencies, handle: string, slug: string, proposal: RecurringPreviewInput, now = new Date()) {
  const [profile, event] = await Promise.all([
    services.hostProfile.getPublicProfile(handle),
    services.eventTypes.resolvePublishedEventForPublicRequest(slug),
  ]);
  if (!profile || !event) return { kind: "not_found" as const };
  const locations = offeredLocations(event);
  const durations = event.durationOptionsMinutes ?? [event.durationMinutes];
  if (event.requestOnly || event.groupCapacity != null || durations.length !== 1 || durations[0] !== event.durationMinutes
    || locations.length !== 1 || !fixedLocations.has(locations[0].type)) return { kind: "unsupported" as const };
  const unsupported = await db.prepare(`SELECT 1 WHERE
    EXISTS (SELECT 1 FROM calendar_connections WHERE status<>'disconnected')
    OR EXISTS (SELECT 1 FROM event_types WHERE id=? AND (approval_required=1 OR guest_limit>0))
    OR EXISTS (SELECT 1 FROM event_type_prices WHERE event_type_id=?)
    OR EXISTS (SELECT 1 FROM event_type_payment_terms WHERE event_type_id=? AND (deposit_kind<>'none' OR late_cancel_fee_cents>0 OR no_show_fee_cents>0))
    OR EXISTS (SELECT 1 FROM team_event_types WHERE event_type_id=?)`).bind(event.id, event.id, event.id, event.id).first();
  if (unsupported) return { kind: "unsupported" as const };

  const first = new Date(proposal.startAt), zone = proposal.inviteeTimezone;
  const firstDate = hostDateForInstant(first.toISOString(), zone), local = zonedParts(first, zone);
  const starts: string[] = [];
  for (let index = 0; index < proposal.count; index++) {
    const date = datePlus(firstDate, index * 7);
    // A skipped local time is refused; an ambiguous future time uses its earlier instant.
    const instant = index === 0 ? first : wallClockInstants(date, local.hour * 60 + local.minute, zone)[0];
    if (!instant || instant.getUTCFullYear() > 9999) return { kind: "invalid_time" as const };
    starts.push(instant.toISOString());
  }

  // Read only the persisted no-calendar mode, never a provider adapter. Recheck
  // inside each availability read so a newly connected calendar stays fail-closed.
  const availability = new AvailabilityService(new AvailabilityRepository(db), services.hostProfile, services.eventTypes, {
    readBusy: async () => await db.prepare("SELECT 1 FROM calendar_connections WHERE status<>'disconnected' LIMIT 1").first()
      ? { kind: "unavailable", code: "recurring_calendar_unsupported" }
      : { kind: "ok", calendarRequired: false, observedAt: now.toISOString(), intervals: [] },
  });
  const occurrences: Array<{ proposed: Time; available: boolean; alternatives: Time[] }> = [];
  for (const startAt of starts) {
    const week = hostDateForInstant(startAt, profile.timezone);
    const result = await availability.listPublicWeek(handle, slug, week, zone, now);
    if (!result || "kind" in result || result.state !== "available") return { kind: "unavailable" as const };
    const available = result.slots.some(slot => slot.startAt === startAt);
    const alternatives = available ? [] : result.slots.filter(slot => !starts.includes(slot.startAt))
      .sort((left, right) => Math.abs(Date.parse(left.startAt) - Date.parse(startAt)) - Math.abs(Date.parse(right.startAt) - Date.parse(startAt))
        || left.startAt.localeCompare(right.startAt))
      .slice(0, 3).map(({ startAt, endAt }) => ({ startAt, endAt }));
    occurrences.push({ proposed: { startAt, endAt: new Date(Date.parse(startAt) + event.durationMinutes * 60_000).toISOString() }, available, alternatives });
  }
  return { kind: "preview" as const, occurrences };
}
