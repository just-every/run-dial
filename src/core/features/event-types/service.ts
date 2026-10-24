import { publicationRequirements, requestRequirements } from "./publication-readiness.server";
import { validHostProfile } from "../host-setup";
import type { ProfileRecord } from "../host-profile";
import { toPublicEventType } from "./public";
import { dateAvailabilityOverrideInputSchema, hostDateToday, isCanonicalIanaTimeZone } from "../../shared/scheduling";
import type { AvailabilityWindowInput, EventDetailsInput, DateAvailabilityOverrideInput, EventTypeInput, EventTypeRecord } from "./repository";
/** A new event's hours: yours, or its own weekly windows. */
export type NewEventHours = { uses: "yours" } | { uses: "own"; windows: AvailabilityWindowInput[] };
export type NewEventType = Omit<EventTypeInput, "availability"> & { availability?: AvailabilityWindowInput[]; hours?: NewEventHours };
import { EventTypesRepository } from "./repository";

export type HostTimezoneReader = { getHostTimezone(): Promise<string | undefined>; getProfile(): Promise<ProfileRecord | undefined> };
export type EventPublicationReadiness = {
  calendar: {
    checkConnection(): Promise<
      | { kind: "healthy"; conferenceCapable: boolean }
      | { kind: "unavailable"; code: string }
    >;
  };
  mail: { checkConnection(): Promise<{ checkedAt: string }> };
  /** Health the scheduled pass and explicit checks record; reading it contacts no provider. */
  recorded: {
    calendar(): Promise<{ state: "healthy" | "unhealthy" | "disconnected"; checkedAt: string | null; reason: string | null; destinationSelected: boolean; conflictCalendarCount: number; conferenceCapable: boolean }>;
    mail(): Promise<{ state: "healthy" | "unhealthy" | "unchecked"; checkedAt: string | null }>;
  };
};
/** The scheduled pass records provider health every minute; older records are refreshed and labelled. */
const recordedHealthCurrentForMs = 2 * 60_000;
export type DateAvailabilityOverrideWriteResult =
  | { kind: "saved"; override: Awaited<ReturnType<EventTypesRepository["replaceDateAvailabilityOverride"]>> }
  | { kind: "event_not_found" | "profile_not_configured" | "profile_timezone_invalid" | "override_in_past" | "invalid_override" };

export class EventTypesService {
  constructor(
    private readonly repository: EventTypesRepository,
    private readonly hostTimezone: HostTimezoneReader,
    private readonly publication?: EventPublicationReadiness,
  ) {}

  listEventTypes() {
    return this.repository.list();
  }

  getEventType(id: string) {
    return this.repository.get(id);
  }

  getPublicEvent(slug: string) {
    return this.repository.getPublishedBySlug(slug);
  }

  /** Server-only resolver. Never return this record from a public route. */
  resolvePublishedEventForPublicRequest(slug: string) {
    return this.repository.getPublishedRecordBySlug(slug);
  }

  async getEventTypePreview(id: string) {
    const eventType = await this.repository.get(id);
    return eventType ? toPublicEventType(eventType) : undefined;
  }

  listPublicListedEventTypes() {
    return this.repository.listPublishedListed();
  }

  /** A new event uses your hours unless it gives its own: `hours`, or windows in the weekly `availability` the API has always taken. */
  createEventType({ hours, availability, ...input }: NewEventType) {
    const own = hours?.uses === "own" ? hours.windows : hours ? undefined : availability?.length ? availability : undefined;
    return own ? this.repository.create({ ...input, availability: own }) : this.repository.create({ ...input, availability: [] }, "yours");
  }

  async duplicateEventType(id: string) {
    const copyId = await this.repository.duplicate(id);
    return copyId ? this.repository.get(copyId) : undefined;
  }

  updateEventType(id: string, input: EventTypeInput) {
    return this.repository.update(id, input);
  }

  updateEventDetails(id: string, input: EventDetailsInput) {
    return this.repository.updateDetails(id, input);
  }

  replaceRecurringAvailability(id: string, windows: AvailabilityWindowInput[]) {
    return this.repository.replaceRecurringAvailability(id, windows);
  }

  effectiveDateOverrides(id: string, firstDate: string, days: number) {
    return this.repository.effectiveDateOverrides(id, firstDate, days);
  }

  disableEventType(id: string) {
    return this.repository.setStatus(id, "disabled");
  }

  deleteEventType(id: string) {
    return this.repository.delete(id);
  }

  ensureDraftEventType(input: EventTypeInput) {
    return this.repository.ensureDraft(input);
  }

  async listDateAvailabilityOverrides(eventTypeId: string) {
    if (!(await this.repository.hasEventType(eventTypeId))) return undefined;
    return this.repository.listDateAvailabilityOverrides(eventTypeId);
  }

  async replaceDateAvailabilityOverride(eventTypeId: string, input: DateAvailabilityOverrideInput): Promise<DateAvailabilityOverrideWriteResult> {
    const parsed = dateAvailabilityOverrideInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid_override" };
    if (!(await this.repository.hasEventType(eventTypeId))) return { kind: "event_not_found" };
    const timezone = await this.hostTimezone.getHostTimezone();
    if (!timezone) return { kind: "profile_not_configured" };
    if (!isCanonicalIanaTimeZone(timezone)) return { kind: "profile_timezone_invalid" };
    if (parsed.data.hostDate < hostDateToday(timezone)) return { kind: "override_in_past" };
    return { kind: "saved", override: await this.repository.replaceDateAvailabilityOverride(eventTypeId, parsed.data) };
  }

  async deleteDateAvailabilityOverride(eventTypeId: string, hostDate: string) {
    if (!(await this.repository.hasEventType(eventTypeId))) return "event_not_found" as const;
    const timezone = await this.hostTimezone.getHostTimezone();
    if (!timezone) return "profile_not_configured" as const;
    if (!isCanonicalIanaTimeZone(timezone)) return "profile_timezone_invalid" as const;
    if (hostDate < hostDateToday(timezone)) return "override_in_past" as const;
    return (await this.repository.deleteDateAvailabilityOverride(eventTypeId, hostDate)) ? "deleted" as const : "not_found" as const;
  }

  async publishReadiness(eventType: EventTypeRecord) {
    const [profile, providers] = await Promise.all([this.hostTimezone.getProfile(), this.providerReadiness()]);
    return publicationRequirements(eventType, profile, providers);
  }

  /** The calendar and sending-address checks publication runs; one pass serves several event types. */
  async providerReadiness() {
    if (!this.publication) return null;
    const [calendar, mail] = await Promise.all([
      this.publication.calendar.checkConnection().catch(() => ({ kind: "unavailable" as const, code: "calendar_unavailable" })),
      this.publication.mail.checkConnection().then(() => ({ kind: "healthy" as const })).catch(() => ({ kind: "unavailable" as const })),
    ]);
    return { calendar, mail };
  }

  async eventReadiness(eventType: EventTypeRecord, providers: Awaited<ReturnType<EventTypesService["providerReadiness"]>>) {
    return publicationRequirements(eventType, await this.hostTimezone.getProfile(), providers);
  }

  /** The last recorded provider health, read without a provider round trip. */
  async recordedProviderReadiness(now = Date.now()) {
    if (!this.publication) return null;
    const [calendar, mail] = await Promise.all([this.publication.recorded.calendar(), this.publication.recorded.mail()]);
    const calendarHealthy = calendar.state === "healthy" && calendar.destinationSelected && calendar.conflictCalendarCount > 0;
    const providers = {
      calendar: calendarHealthy
        ? { kind: "healthy" as const, conferenceCapable: calendar.conferenceCapable }
        : { kind: "unavailable" as const, code: calendar.state === "disconnected" ? "not_connected" : calendar.reason ?? "calendar_unavailable" },
      mail: mail.state === "healthy" ? { kind: "healthy" as const } : { kind: "unavailable" as const },
    };
    // A failed calendar check keeps its last success time, so only a healthy calendar dates this result.
    const checkedAt = mail.checkedAt && [mail.checkedAt, ...(calendarHealthy && calendar.checkedAt ? [calendar.checkedAt] : [])].sort()[0];
    const state = !checkedAt ? "unrecorded" as const : now - Date.parse(checkedAt) > recordedHealthCurrentForMs ? "stale" as const : "current" as const;
    return { providers, checkedAt: checkedAt || null, state };
  }

  /** Readiness from recorded provider health; publication and request opening still check providers live. */
  async getReadiness(id: string) {
    const [event, profile, recorded] = await Promise.all([this.getEventType(id), this.hostTimezone.getProfile(), this.recordedProviderReadiness()]);
    if (!event) return undefined;
    const providers = recorded?.providers ?? null;
    const requests = this.requestOpeningReadiness(event, requestRequirements(event, profile, providers?.mail.kind === "healthy"));
    return { ...publicationRequirements(event, profile, providers), requests, checkedAt: recorded?.checkedAt ?? null, recorded: recorded?.state ?? "current" as const };
  }

  completionReadiness(event: EventTypeRecord) {
    return event.requestOnly ? this.requestRequirements(event) : this.publishReadiness(event);
  }

  async requestReadiness(event: EventTypeRecord) {
    return this.requestOpeningReadiness(event, await this.requestRequirements(event));
  }

  private requestOpeningReadiness(event: EventTypeRecord, readiness: { ready: boolean; missing: string[] }) {
    const missing = [...readiness.missing, ...(event.status === "published" ? ["event_already_published"] : [])];
    return { ready: missing.length === 0, missing };
  }

  private async requestRequirements(event: EventTypeRecord) {
    const [profile, mailHealthy] = await Promise.all([
      this.hostTimezone.getProfile(),
      this.publication?.mail.checkConnection().then(() => true).catch(() => false),
    ]);
    return requestRequirements(event, profile, mailHealthy === true);
  }

  async openRequests(id: string) {
    const event = await this.repository.get(id);
    if (!event) return { kind: "event_not_found" as const };
    const readiness = await this.requestReadiness(event);
    if (!readiness.ready) return { kind: "not_ready" as const, readiness };
    const profile = await this.hostTimezone.getProfile();
    if (!validHostProfile(profile)) return { kind: "not_ready" as const, readiness: { ready: false, missing: ["host_profile"] } };
    const opened = await this.repository.openRequestsChecked(event, profile!);
    return opened ? { kind: "published" as const, eventType: opened } : { kind: "not_ready" as const, readiness: { ready: false, missing: ["event_configuration_changed"] } };
  }

  setAlternativeRequests(id: string, enabled: boolean) { return this.repository.setAlternativeRequests(id, enabled); }

  async publishEventType(id: string) {
    const eventType = await this.repository.get(id);
    if (!eventType) return { kind: "event_not_found" as const };
    const readiness = await this.publishReadiness(eventType);
    if (!readiness.ready) return { kind: "not_ready" as const, readiness };
    const profile = await this.hostTimezone.getProfile();
    if (!validHostProfile(profile)) return { kind: "not_ready" as const, readiness: { ready: false, missing: ["host_profile"] } };
    const published = await this.repository.publishChecked(eventType, profile!);
    if (published) return { kind: "published" as const, eventType: published };
    const current = await this.repository.get(id);
    if (!current) return { kind: "event_not_found" as const };
    return { kind: "not_ready" as const, readiness: { ready: false, missing: [...(current.availability.length === 0 ? ["open_availability"] : []), "event_configuration_changed"] } };
  }
}
