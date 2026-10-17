import { offeredLocations, locationIssue } from "./locations";
import { validHostProfile } from "../host-setup";
import type { ProfileRecord } from "../host-profile";
import type { EventTypeRecord } from "./repository";
import type { EventTypesService } from "./service";

export function publicationRequirements(eventType: EventTypeRecord, profile: ProfileRecord | undefined, providers: Awaited<ReturnType<EventTypesService["providerReadiness"]>>) {
  const missing = [
    ...(!validHostProfile(profile) ? ["host_profile"] : []),
    ...(eventType.availability.length === 0 ? ["open_availability"] : []),
    ...(offeredLocations(eventType).some(location => locationIssue(location)) ? ["private_location"] : []),
  ];
  if (!providers) return { ready: false, missing: [...missing, "transactional_mail", "destination_calendar", ...(offeredLocations(eventType).some(location => location.type === "google_meet") ? ["google_meet_capability"] : [])] };
  const { calendar, mail } = providers;
  if (calendar.kind !== "healthy" && calendar.code !== "not_connected") missing.push("destination_calendar");
  if (mail.kind !== "healthy") missing.push("transactional_mail");
  if (offeredLocations(eventType).some(location => location.type === "google_meet") && (calendar.kind !== "healthy" || !calendar.conferenceCapable)) missing.push("google_meet_capability");
  return { ready: missing.length === 0, missing };
}

export function requestRequirements(event: EventTypeRecord, profile: ProfileRecord | undefined, mailHealthy: boolean) {
  const missing = [
    ...(!validHostProfile(profile) ? ["host_profile"] : []),
    ...(!event.alternativeRequestsEnabled ? ["alternative_requests_enabled"] : []),
    ...(!mailHealthy ? ["transactional_mail"] : []),
  ];
  return { ready: missing.length === 0, missing };
}
