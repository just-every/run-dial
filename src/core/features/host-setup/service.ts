import type { EventTypesService } from "../event-types";
import type { HostProfileService } from "../host-profile";
import { eligibleBookingUrl, validHostProfile } from "./eligibility";
import { HostSetupRepository } from "./repository";

export class HostSetupService {
  constructor(private readonly repository: HostSetupRepository, private readonly profiles: HostProfileService, private readonly events: EventTypesService, private readonly publicOrigin: string) {}

  completion() { return this.repository.completion(); }

  async complete() {
    const existing = await this.completion();
    if (existing) return { kind: "completed" as const, completedAt: existing, next: "/app" as const };
    const [profile, events, reports] = await Promise.all([this.profiles.getProfile(), this.events.listEventTypes(), this.repository.reports()]);
    if (!validHostProfile(profile) || !profile) return { kind: "not_ready" as const, missing: ["host_profile"] };
    const missing = new Set<string>();
    for (const event of events) {
      const url = eligibleBookingUrl(this.publicOrigin, profile, event);
      if (!url || !reports.some(report => report.eventTypeId === event.id && report.canonicalUrl === url)) continue;
      const readiness = await this.events.completionReadiness(event);
      if (!readiness.ready) { readiness.missing.forEach(code => missing.add(code)); continue; }
      const completedAt = await this.repository.complete(event, profile, url);
      if (completedAt) return { kind: "completed" as const, completedAt, next: "/app" as const };
      missing.add("event_configuration_changed");
    }
    return { kind: "not_ready" as const, missing: missing.size ? [...missing] : ["copied_public_event"] };
  }

  async read() {
    const [profile, events, reports] = await Promise.all([this.profiles.getProfile(), this.events.listEventTypes(), this.repository.reports()]);
    const links = events.flatMap((event) => {
      const url = eligibleBookingUrl(this.publicOrigin, profile, event);
      return url ? [{ eventTypeId: event.id, title: event.title, url, requestOnly: Boolean(event.requestOnly), copiedAt: reports.find((report) => report.eventTypeId === event.id && report.canonicalUrl === url)?.acceptedAt ?? null }] : [];
    });
    return { completedAt: await this.completion(), publicOrigin: this.publicOrigin, profileReady: validHostProfile(profile), availabilityReady: events.some((event) => event.availability.length > 0), eventTypeId: events[0]?.id ?? null, links, moveInStarted: await this.repository.moveInStarted() };
  }

  async reportCopy(eventId: string, submittedUrl: string) {
    const [profile, event] = await Promise.all([this.profiles.getProfile(), this.events.getEventType(eventId)]);
    if (!event) return { kind: "event_not_found" as const };
    const url = eligibleBookingUrl(this.publicOrigin, profile, event);
    if (!url || !profile) return { kind: "link_not_eligible" as const };
    if (submittedUrl !== url) return { kind: "booking_link_changed" as const };
    const report = await this.repository.record(event, profile, url);
    return report ? { kind: "recorded" as const, report } : { kind: "booking_link_changed" as const };
  }
}

export type HostSetupState = Awaited<ReturnType<HostSetupService["read"]>>;
export type BookingLink = HostSetupState["links"][number];
