import type { ManagedCalendarChange, ManagedCalendarEvent, ManagedCalendarEventResult } from "./types";
import { ProviderFailure } from "./types";
import { graphBase, graphInstant, graphPages, isRecord, MicrosoftWire } from "./microsoft-wire";
// Named MAPI properties survive a lost HTTP response and are not user-visible invitation text.
const propertySet = "{8eccc264-8d2a-4c71-8815-7a330c7c8695}";
export const bookingProperty = `String ${propertySet} Name DialBookingId`;
export const occurrenceProperty = `String ${propertySet} Name DialOccurrenceId`;
const uidProperty = `String ${propertySet} Name DialIcalUid`;
export const eventExpansion = `singleValueExtendedProperties($filter=id eq '${bookingProperty}' or id eq '${occurrenceProperty}' or id eq '${uidProperty}')`;
export function calendarEvents(calendarId: string) { return `${graphBase}/me/calendars/${encodeURIComponent(calendarId)}/events`; }
export async function findMicrosoftEvent(wire: MicrosoftWire, token: string, calendarId: string, bookingId: string) {
  const url = new URL(calendarEvents(calendarId));
  url.searchParams.set("$filter", `singleValueExtendedProperties/Any(ep: ep/id eq '${bookingProperty}' and ep/value eq '${bookingId.replaceAll("'", "''")}')`);
  url.searchParams.set("$expand", eventExpansion);
  const items = (await graphPages(wire, token, url.toString())).filter(isRecord).filter(item => item.isCancelled !== true);
  if (items.length > 1) throw new ProviderFailure("invalid_provider_response", false);
  return items[0];
}
export function microsoftPayload(event: ManagedCalendarEvent, existing: boolean) {
  return { subject: event.title, body: { contentType: "text", content: event.description },
    start: { dateTime: new Date(event.startAt).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: new Date(event.endAt).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
    location: { displayName: event.location }, showAs: event.transparency === "transparent" ? "free" : "busy",
    attendees: [event.inviteeEmail, ...(event.guestEmails ?? [])].map(address => ({ emailAddress: { address }, type: "required" })),
    singleValueExtendedProperties: [{ id: bookingProperty, value: event.bookingId }, { id: occurrenceProperty, value: event.occurrenceId }, { id: uidProperty, value: event.icalUid }],
    ...(!existing ? { transactionId: event.bookingId, ...(event.requestMicrosoftTeams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}) } : {}),
  };
}
export function microsoftResult(value: Record<string, unknown>): ManagedCalendarEventResult {
  if (typeof value.id !== "string" || typeof value.lastModifiedDateTime !== "string" || !Number.isFinite(Date.parse(value.lastModifiedDateTime))) throw new ProviderFailure("invalid_provider_response", false);
  const meeting = isRecord(value.onlineMeeting) ? value.onlineMeeting : undefined;
  const url = typeof meeting?.joinUrl === "string" ? meeting.joinUrl : undefined;
  if (url && new URL(url).protocol !== "https:") throw new ProviderFailure("invalid_provider_response", false);
  return { providerEventId: value.id, providerUpdatedAt: value.lastModifiedDateTime, conferenceUrl: url,
    conferenceState: url ? "ready" : value.isOnlineMeeting === true ? "pending" : "not_requested" };
}
export function microsoftChange(value: unknown): ManagedCalendarChange | undefined {
  if (!isRecord(value) || typeof value.id !== "string") throw new ProviderFailure("invalid_provider_response", false);
  if (isRecord(value["@removed"]) || value.isCancelled === true) return { kind: "deleted", providerEventId: value.id };
  const properties = Array.isArray(value.singleValueExtendedProperties) ? value.singleValueExtendedProperties.filter(isRecord) : [];
  const bookingId = properties.find(item => item.id === bookingProperty)?.value;
  const occurrenceId = properties.find(item => item.id === occurrenceProperty)?.value;
  if (typeof bookingId !== "string" || typeof occurrenceId !== "string") return undefined;
  if (typeof value.lastModifiedDateTime !== "string" || !Number.isFinite(Date.parse(value.lastModifiedDateTime))) throw new ProviderFailure("invalid_provider_response", false);
  return { kind: "changed", bookingId, occurrenceId, providerEventId: value.id, updatedAt: value.lastModifiedDateTime,
    startAt: graphInstant(value.start), endAt: graphInstant(value.end), location: isRecord(value.location) && typeof value.location.displayName === "string" ? value.location.displayName : "" };
}
