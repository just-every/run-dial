import type { BookingLinksService } from "../booking-links";
import type { LinkEvent } from "../booking-links";
import { resolveEventDuration } from "../../shared/event-duration";
import { hasSupportedInstantPrecision } from "../../shared/instants";
import type { EventTypesService } from "../event-types";
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
    private readonly links?: BookingLinksService,
  ) {}

  async listPublicWeek(handle: string, slug: string, week: string | undefined, inviteeTimeZone?: string, now = new Date(), durationMinutes?: number, link?: string): Promise<AvailabilityResult | { kind: "invalid_duration" | "link_used" | "link_expired" } | undefined> {
    const [profile, event] = await Promise.all([
      this.profiles.getPublicProfile(handle),
      this.resolvePublicEvent(slug, link),
    ]);
    if (!profile || !event) return undefined;
    if ("kind" in event) return event;
    const selectedDuration = resolveEventDuration(event, durationMinutes);
    if (selectedDuration === undefined) return { kind: "invalid_duration" };
    const today = hostDateAt(now, profile.timezone);
    const firstDate = week ?? event.bookingLink?.dates?.map(date=>date.hostDate).sort().find(date=>date>=today) ?? today;
    return this.listEventWeek({ ...event, durationMinutes: selectedDuration }, profile.timezone, firstDate, inviteeTimeZone, now);
  }

  async verifyPublicSelection(handle: string, slug: string, startAt: string, now = new Date(), excludedBookingId?: string, durationMinutes?: number, retainedDurationMinutes?: number, link?: string) {
    const [profile, event] = await Promise.all([
      this.profiles.getPublicProfile(handle),
      this.resolvePublicEvent(slug, link),
    ]);
    if (!profile || !event) return { kind: "not_found" as const };
    if ("kind" in event) return { kind: "not_found" as const };
    return this.verifyResolvedPublicSelection(profile, event, startAt, now, excludedBookingId, durationMinutes, retainedDurationMinutes);
  }

  private async resolvePublicEvent(slug: string, token?: string): Promise<LinkEvent | { kind: "link_used" | "link_expired" } | undefined> {
    if (!this.links) return token ? undefined : this.eventTypes.resolvePublishedEventForPublicRequest(slug);
    const result = await this.links.resolve(slug, token);
    return !result || result.kind === "expired" && result.event.bookingLink?.kind === "one_off" ? undefined : result.kind === "active" ? result.event : { kind: result.kind === "used" ? "link_used" : "link_expired" };
  }

  async verifyResolvedPublicSelection(profile: NonNullable<Awaited<ReturnType<HostProfileService["getPublicProfile"]>>>, event: LinkEvent, startAt: string, now = new Date(), excludedBookingId?: string, durationMinutes?: number, retainedDurationMinutes?: number) {
    const selectedDuration = resolveEventDuration(event, durationMinutes ?? retainedDurationMinutes, retainedDurationMinutes);
    if (selectedDuration === undefined) return { kind: "invalid_duration" as const };
    const effectiveEvent = { ...event, durationMinutes: selectedDuration };
    const hostDate = hostDateForInstant(startAt, profile.timezone);
    const selected = await this.listEventWeek(effectiveEvent, profile.timezone, hostDate, undefined, now, "fresh", excludedBookingId, { overrideNoticeAndHorizon: false, includeRecommendations: false }, 1);
    if (selected.state === "temporarily_unavailable") return { kind: "calendar_unavailable" as const };
    const slot = selected.slots.find((candidate) => candidate.startAt === startAt);
    return slot ? { kind: "valid" as const, profile, event: effectiveEvent, slot, calendarRequired: selected.calendarRequired } : { kind: "slot_invalid" as const };
  }

  /** The booking service resolves both IDs from a validated manage capability. */
  async listRescheduleWeek(eventTypeId: string, excludedBookingId: string, week?: string, inviteeTimeZone?: string, now = new Date(), durationMinutes?: number, retainedDurationMinutes?: number): Promise<AvailabilityResult | { kind: "invalid_duration" } | undefined> {
    const [profile, event] = await Promise.all([this.profiles.getProfile(), this.resolveManagedEvent(eventTypeId,excludedBookingId)]);
    if (!profile || !event || event.status !== "published") return undefined;
    const selectedDuration = resolveEventDuration(event, durationMinutes ?? retainedDurationMinutes, retainedDurationMinutes);
    if (selectedDuration === undefined) return { kind: "invalid_duration" };
    return this.listEventWeek({ ...event, durationMinutes: selectedDuration }, profile.timezone, week ?? hostDateAt(now, profile.timezone), inviteeTimeZone, now, "cached", excludedBookingId);
  }

  private async resolveManagedEvent(eventTypeId:string,bookingId:string) {
    return await this.links?.resolveForBooking(bookingId) ?? this.eventTypes.getEventType(eventTypeId);
  }
  async verifyManagedSelection(eventTypeId:string,bookingId:string,startAt:string,now = new Date(),durationMinutes?:number,retainedDurationMinutes?:number) {
    const [profile,event]=await Promise.all([this.profiles.getProfile(),this.resolveManagedEvent(eventTypeId,bookingId)]);
    if (!profile || !event || event.status!=="published") return {kind:"not_found" as const};
    return this.verifyResolvedPublicSelection(profile,event,startAt,now,bookingId,durationMinutes,retainedDurationMinutes);
  }

  /**
   * Operator-created bookings use a fresh provider read and the same
   * buffer/conflict arithmetic. BOOK-012 may relax only notice and horizon;
   * BOOK-009 separately opts a reschedule out of published windows. Neither
   * path can bypass a busy interval, internal claim, buffer, or host-day cap.
   */
  async verifyOperatorSelection(eventTypeId: string, startAt: string, options: { overrideNoticeAndHorizon: boolean; overridePublishedAvailability?: boolean }, now = new Date(), excludedBookingId?: string, durationMinutes?: number, retainedDurationMinutes?: number) {
    if (!hasSupportedInstantPrecision(startAt)) return { kind: "slot_invalid" as const, exclusions: ["start_increment" as const] };
    const [profile, event] = await Promise.all([
      this.profiles.getProfile(),
      this.eventTypes.getEventType(eventTypeId),
    ]);
    if (!profile || !event) return { kind: "not_found" as const };
    const selectedDuration = resolveEventDuration(event, durationMinutes ?? retainedDurationMinutes, retainedDurationMinutes);
    if (selectedDuration === undefined) return { kind: "invalid_duration" as const };
    const effectiveEvent = { ...event, durationMinutes: selectedDuration };
    const hostDate = hostDateForInstant(startAt, profile.timezone);
    const loaded = await this.loadInput(effectiveEvent, profile.timezone, hostDate, 1, now, "fresh", options, excludedBookingId);
    if (!loaded) return { kind: "calendar_unavailable" as const };
    const slot = listAvailableSlots(loaded.input).find((candidate) => Date.parse(candidate.startAt) === Date.parse(startAt));
    return slot ? { kind: "valid" as const, profile, event: effectiveEvent, slot, calendarRequired: loaded.calendarRequired }
      : { kind: "slot_invalid" as const, exclusions: diagnoseAvailability(loaded.input, startAt, now).exclusions };
  }

  async diagnoseOperatorTime(eventTypeId: string, startAt: string, options: { overrideNoticeAndHorizon: boolean } = { overrideNoticeAndHorizon: false }, now = new Date(), durationMinutes?: number) {
    if (!hasSupportedInstantPrecision(startAt) || !Number.isFinite(Date.parse(startAt))) return { kind: "invalid_time" as const };
    const [profile, event] = await Promise.all([this.profiles.getProfile(), this.eventTypes.getEventType(eventTypeId)]);
    if (!profile || !event) return { kind: "not_found" as const };
    const selectedDuration = resolveEventDuration(event, durationMinutes);
    if (selectedDuration === undefined) return { kind: "invalid_duration" as const };
    const loaded = await this.loadInput({ ...event, durationMinutes: selectedDuration }, profile.timezone, hostDateForInstant(startAt, profile.timezone), 1, now, "fresh", options);
    return loaded ? { kind: "evaluated" as const, diagnosis: diagnoseAvailability(loaded.input, startAt, now) } : { kind: "calendar_unavailable" as const };
  }

  private async listEventWeek(
    event: LinkEvent,
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
  private loadInput(event: LinkEvent, zone: string, date: string, days: number, now: Date, freshness: "cached" | "fresh", options: OperatorAvailabilityOptions, excludedBookingId?: string) {
    return loadAvailabilityInput({ repository: this.repository, calendar: this.calendar, eventTypes: this.eventTypes }, event, zone, date, days, now, freshness, options, excludedBookingId);
  }
}
