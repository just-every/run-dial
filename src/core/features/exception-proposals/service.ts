import type { EventTypesService } from "../event-types";
import { offeredLocations } from "../event-types/client";
import type { HostProfileService } from "../host-profile";
import { AvailabilityRequestsRepository } from "../availability-requests";
import { AvailabilityRepository, BookingLimits, NamedSchedules, loadAvailabilityInput, type CalendarBusyReader } from "../availability";
import { inviteeSpans, requestedHostDates, planExceptionDay } from "./planner";

const fixedLocations = new Set(["fixed_link", "phone", "in_person", "custom"]);

/** Advisory owner reads have no booking, recovery, delivery or grant-execution capability. */
export class ExceptionProposalsService {
  constructor(private readonly db: D1Database, private readonly eventTypes: EventTypesService,
    private readonly profiles: HostProfileService, private readonly calendar: CalendarBusyReader) {}

  private async connectedCalendar() {
    return Boolean(await this.db.prepare("SELECT 1 FROM calendar_connections WHERE status<>'disconnected' LIMIT 1").first());
  }

  async read(requestId: string, now = new Date()) {
    const request = await new AvailabilityRequestsRepository(this.db).get(requestId);
    if (!request) return { kind: "not_found" as const };
    if (request.state !== "submitted" || request.bookingId) return { kind: "resolved" as const };
    const [event, profile] = await Promise.all([this.eventTypes.getEventType(request.eventTypeId), this.profiles.getProfile()]);
    if (!event || event.status !== "published" || !profile) return { kind: "not_found" as const };
    const durations = event.durationOptionsMinutes ?? [event.durationMinutes], locations = offeredLocations(event);
    if (event.requestOnly || event.groupCapacity != null || durations.length !== 1 || durations[0] !== event.durationMinutes
      || locations.length !== 1 || !fixedLocations.has(locations[0].type)) return { kind: "unsupported" as const };
    const unsupported = await this.db.prepare(`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM event_types WHERE id=? AND (approval_required=1 OR guest_limit>0))
      OR EXISTS (SELECT 1 FROM event_type_prices WHERE event_type_id=?)
      OR EXISTS (SELECT 1 FROM event_type_payment_terms WHERE event_type_id=? AND (deposit_kind<>'none' OR late_cancel_fee_cents>0 OR no_show_fee_cents>0))
      OR EXISTS (SELECT 1 FROM team_event_types WHERE event_type_id=?)`).bind(event.id, event.id, event.id, event.id).first();
    if (unsupported || await this.connectedCalendar()) return { kind: "unsupported" as const };
    const schedules = new NamedSchedules(this.db), host = await schedules.yours();
    // Native event creation can insert untouched starting hours. They are not an affirmative host save.
    if (!host || host.updatedAt <= host.createdAt || !host.windows.length) return { kind: "host_hours_required" as const };
    const windows = inviteeSpans(request.windows, request.inviteeTimezone);
    const repository = new AvailabilityRepository(this.db), limits = new BookingLimits(this.db);
    const proposals: ReturnType<typeof planExceptionDay> = [];
    for (const date of requestedHostDates(windows, profile.timezone)) {
      // Recheck immediately before the actual native no-calendar read. Never recover a connection.
      if (await this.connectedCalendar()) return { kind: "unsupported" as const };
      const loaded = await loadAvailabilityInput({ repository, eventTypes: this.eventTypes, calendar: {
        readBusy: async input => await this.connectedCalendar()
          ? { kind: "unavailable", code: "exception_calendar_unsupported" }
          : this.calendar.readBusy(input),
      } }, event, profile.timezone, date, 1, now, "fresh", { overrideNoticeAndHorizon: false });
      if (!loaded || loaded.calendarRequired) return { kind: "unavailable" as const };
      // This request has no booking to exclude; pass its stored identity to the real invitee-gap reader.
      loaded.input.additionalExclusions = await repository.limitsForRange(event.id, profile.timezone, date, 1, undefined, request.inviteeEmail);
      const closures = await schedules.applyClosures([], date, 1);
      proposals.push(...planExceptionDay(loaded.input, host, event.availability, windows, closures));
    }
    return { kind: "proposals" as const, result: {
      requestId, eventTypeId: event.id, advisory: true as const, hostTimezone: profile.timezone, inviteeTimezone: request.inviteeTimezone,
      proposals: [...new Map(proposals.map(slot => [slot.startAt, slot])).values()].sort((left, right) => left.startAt.localeCompare(right.startAt)).slice(0, 3),
      sources: {
        hostHours: { id: host.id, updatedAt: host.updatedAt }, event: { id: event.id, updatedAt: event.updatedAt },
        request: { id: request.id, submittedAt: request.submittedAt }, calendar: "not_connected" as const,
        constraints: { durationMinutes: event.durationMinutes, slotIncrementMinutes: event.slotIncrementMinutes,
          minimumNoticeMinutes: event.minimumNoticeMinutes, bookingHorizonDays: event.bookingHorizonDays,
          bookingHorizonMode: event.bookingHorizonMode, bookingStartDate: event.bookingStartDate, bookingEndDate: event.bookingEndDate,
          beforeBufferMinutes: event.beforeBufferMinutes, afterBufferMinutes: event.afterBufferMinutes, hostDayBookingLimit: event.hostDayBookingLimit,
          limits: { host: await limits.get("host"), event: await limits.get(event.id) } },
      },
    } };
  }
}
