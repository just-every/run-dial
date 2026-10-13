import { hasSupportedInstantPrecision } from "../../shared/instants";
import type { EventTypeRecord, EventTypesService } from "../event-types";
import type { HostProfileService } from "../host-profile";
import { hostDateAt } from "./timezone";
import { loadAvailabilityInput, type OperatorAvailabilityOptions } from "./input";
import { hostDateForInstant, buildRecommendationContext, listAvailableSlots, rankSlots, type AvailableSlot, type BusyInterval } from "./engine";
import { AvailabilityRepository } from "./repository";
import { diagnoseAvailability } from "./diagnostics";

export type CalendarBusyRead =
  | { kind: "ok"; calendarRequired?: boolean; observedAt: string; intervals: BusyInterval[] }
  | { kind: "unavailable"; code: string };

/** This is deliberately the only calendar capability availability receives. */
export type CalendarBusyReader = {
  readBusy(input: { startAt: string; endAt: string; freshness: "cached" | "fresh" }): Promise<CalendarBusyRead>;
};

export type AvailabilityResult =
  | { state: "available"; calendarRequired: boolean; week: string; slots: AvailableSlot[]; recommendations: Array<AvailableSlot & { reason: string }>; rankedSlots: Array<AvailableSlot & { reason: string }> }
  | { state: "temporarily_unavailable"; provider: "calendar_provider_unavailable"; slots: [] };

export class AvailabilityService {
  constructor(
    private readonly repository: AvailabilityRepository,
    private readonly profiles: HostProfileService,
    private readonly eventTypes: EventTypesService,
    private readonly calendar: CalendarBusyReader,
  ) {}

  async listPublicWeek(handle: string, slug: string, week: string | undefined, inviteeTimeZone?: string, now = new Date()): Promise<AvailabilityResult | undefined> {
    const [profile, event] = await Promise.all([
      this.profiles.getPublicProfile(handle),
      this.eventTypes.resolvePublishedEventForPublicRequest(slug),
    ]);
    if (!profile || !event) return undefined;
    const firstDate = week ?? hostDateAt(now, profile.timezone);
    return this.listEventWeek(event, profile.timezone, firstDate, inviteeTimeZone, now);
  }

  async verifyPublicSelection(handle: string, slug: string, startAt: string, now = new Date(), excludedBookingId?: string) {
    const [profile, event] = await Promise.all([
      this.profiles.getPublicProfile(handle),
      this.eventTypes.resolvePublishedEventForPublicRequest(slug),
    ]);
    if (!profile || !event) return { kind: "not_found" as const };
    const hostDate = hostDateForInstant(startAt, profile.timezone);
    const selected = await this.listEventWeek(event, profile.timezone, hostDate, undefined, now, "fresh", excludedBookingId, { overrideNoticeAndHorizon: false, includeRecommendations: false }, 1);
    if (selected.state === "temporarily_unavailable") return { kind: "calendar_unavailable" as const };
    const slot = selected.slots.find((candidate) => candidate.startAt === startAt);
    return slot ? { kind: "valid" as const, profile, event, slot, calendarRequired: selected.calendarRequired } : { kind: "slot_invalid" as const };
  }

  /** The booking service resolves both IDs from a validated manage capability. */
  async listRescheduleWeek(eventTypeId: string, excludedBookingId: string, week?: string, inviteeTimeZone?: string, now = new Date()): Promise<AvailabilityResult | undefined> {
    const [profile, event] = await Promise.all([this.profiles.getProfile(), this.eventTypes.getEventType(eventTypeId)]);
    if (!profile || !event || event.status !== "published") return undefined;
    return this.listEventWeek(event, profile.timezone, week ?? hostDateAt(now, profile.timezone), inviteeTimeZone, now, "cached", excludedBookingId);
  }

  /**
   * Operator-created bookings use a fresh provider read and the same
   * buffer/conflict arithmetic. BOOK-012 may relax only notice and horizon;
   * BOOK-009 separately opts a reschedule out of published windows. Neither
   * path can bypass a busy interval, internal claim, buffer, or host-day cap.
   */
  async verifyOperatorSelection(eventTypeId: string, startAt: string, options: { overrideNoticeAndHorizon: boolean; overridePublishedAvailability?: boolean }, now = new Date(), excludedBookingId?: string) {
    if (!hasSupportedInstantPrecision(startAt)) return { kind: "slot_invalid" as const, exclusions: ["start_increment" as const] };
    const [profile, event] = await Promise.all([
      this.profiles.getProfile(),
      this.eventTypes.getEventType(eventTypeId),
    ]);
    if (!profile || !event) return { kind: "not_found" as const };
    const hostDate = hostDateForInstant(startAt, profile.timezone);
    const loaded = await this.loadInput(event, profile.timezone, hostDate, 1, now, "fresh", options, excludedBookingId);
    if (!loaded) return { kind: "calendar_unavailable" as const };
    const slot = listAvailableSlots(loaded.input).find((candidate) => Date.parse(candidate.startAt) === Date.parse(startAt));
    return slot ? { kind: "valid" as const, profile, event, slot, calendarRequired: loaded.calendarRequired }
      : { kind: "slot_invalid" as const, exclusions: diagnoseAvailability(loaded.input, startAt, now).exclusions };
  }

  async diagnoseOperatorTime(eventTypeId: string, startAt: string, options: { overrideNoticeAndHorizon: boolean } = { overrideNoticeAndHorizon: false }, now = new Date()) {
    if (!hasSupportedInstantPrecision(startAt) || !Number.isFinite(Date.parse(startAt))) return { kind: "invalid_time" as const };
    const [profile, event] = await Promise.all([this.profiles.getProfile(), this.eventTypes.getEventType(eventTypeId)]);
    if (!profile || !event) return { kind: "not_found" as const };
    const loaded = await this.loadInput(event, profile.timezone, hostDateForInstant(startAt, profile.timezone), 1, now, "fresh", options);
    return loaded ? { kind: "evaluated" as const, diagnosis: diagnoseAvailability(loaded.input, startAt, now) } : { kind: "calendar_unavailable" as const };
  }

  private async listEventWeek(
    event: EventTypeRecord,
    hostTimeZone: string,
    firstDate: string,
    inviteeTimeZone: string | undefined,
    now: Date,
    freshness: "cached" | "fresh" = "cached",
    excludedBookingId?: string,
    operatorOverride: OperatorAvailabilityOptions = { overrideNoticeAndHorizon: false },
    days = 7,
  ): Promise<AvailabilityResult> {
    const loaded = await this.loadInput(event, hostTimeZone, firstDate, days, now, freshness, operatorOverride, excludedBookingId);
    if (!loaded) return { state: "temporarily_unavailable", provider: "calendar_provider_unavailable", slots: [] };
    const { input, range } = loaded;
    const slots = listAvailableSlots(input);
    const rankedSlots = slots.length && operatorOverride.includeRecommendations !== false
      ? rankSlots(slots, buildRecommendationContext(input, range, inviteeTimeZone), slots.length) : [];
    return { state: "available", calendarRequired: loaded.calendarRequired, week: firstDate, slots, recommendations: rankedSlots.slice(0, 5), rankedSlots };
  }
  private loadInput(event: EventTypeRecord, zone: string, date: string, days: number, now: Date, freshness: "cached" | "fresh", options: OperatorAvailabilityOptions, excludedBookingId?: string) {
    return loadAvailabilityInput({ repository: this.repository, calendar: this.calendar, eventTypes: this.eventTypes }, event, zone, date, days, now, freshness, options, excludedBookingId);
  }
}
