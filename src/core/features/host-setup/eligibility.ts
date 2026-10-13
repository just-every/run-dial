import { isCanonicalIanaTimeZone } from "../../shared/scheduling";
import type { ProfileRecord } from "../host-profile";
import type { EventTypeRecord } from "../event-types";

export function validHostProfile(profile: Pick<ProfileRecord, "name" | "handle" | "timezone"> | undefined | null) {
  return Boolean(profile && profile.name.trim() && /^[a-z0-9-]{1,80}$/.test(profile.handle) && isCanonicalIanaTimeZone(profile.timezone));
}

/** APP_URL has already passed the runtime configuration boundary. */
export function eligibleBookingUrl(publicOrigin: string, profile: ProfileRecord | undefined, event: EventTypeRecord) {
  if (!validHostProfile(profile) || event.status !== "published" || (event.requestOnly && !event.alternativeRequestsEnabled)) return null;
  return bookingUrl(publicOrigin, profile!, event);
}

/** The event's public booking link; live once the event is published. */
export function bookingUrl(publicOrigin: string, profile: ProfileRecord, event: EventTypeRecord) {
  return new URL(`/book/${profile.handle}/${event.slug}`, publicOrigin).href;
}
