import { isRecord } from "./google-wire";
import { instant } from "./microsoft-busy";
import { ProviderFailure, type ManagedCalendarChange, type ManagedCalendarEvent, type ManagedCalendarEventResult } from "./types";

const property = (name: string) => `String {691c658f-00b5-48f6-bf46-4ab970bbf5eb} Name ${name}`;
export const bookingProperty = property("DialBookingId");
export function microsoftEvent(event: ManagedCalendarEvent, creating: boolean) {
  return { subject: event.title, body: { contentType: "text", content: event.description }, location: { displayName: event.location },
    start: { dateTime: wallTime(event.startAt, event.timeZone), timeZone: event.timeZone }, end: { dateTime: wallTime(event.endAt, event.timeZone), timeZone: event.timeZone },
    showAs: event.transparency === "transparent" ? "free" : "busy", ...(creating ? { transactionId: event.bookingId } : {}),
    attendees: [event.inviteeEmail, ...(event.guestEmails ?? [])].map(address => ({ emailAddress: { address }, type: "required" })),
    singleValueExtendedProperties: [{ id: bookingProperty, value: event.bookingId }, { id: property("DialOccurrenceId"), value: event.occurrenceId }, { id: property("DialIcalUid"), value: event.icalUid }],
  };
}
export function microsoftResult(value: Record<string, unknown>): ManagedCalendarEventResult {
  if (typeof value.id !== "string" || typeof value.lastModifiedDateTime !== "string" || !Number.isFinite(Date.parse(value.lastModifiedDateTime))) throw new ProviderFailure("invalid_provider_response", false);
  return { providerEventId: value.id, providerUpdatedAt: new Date(value.lastModifiedDateTime).toISOString(), conferenceState: "not_requested" };
}
export function microsoftChange(value: unknown): ManagedCalendarChange | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  if (isRecord(value["@removed"]) || value.isCancelled === true) return { kind: "deleted", providerEventId: value.id, ...(typeof value.lastModifiedDateTime === "string" ? { updatedAt: value.lastModifiedDateTime } : {}) };
  const properties = Array.isArray(value.singleValueExtendedProperties) ? value.singleValueExtendedProperties : [];
  const get = (id: string) => { const entry = properties.find(entry => isRecord(entry) && entry.id === id); return isRecord(entry) && typeof entry.value === "string" ? entry.value : undefined; };
  const bookingId = get(bookingProperty), occurrenceId = get(property("DialOccurrenceId"));
  if (!bookingId || !occurrenceId || typeof value.lastModifiedDateTime !== "string") return undefined;
  return { kind: "changed", providerEventId: value.id, bookingId, occurrenceId, updatedAt: value.lastModifiedDateTime, startAt: instant(value.start), endAt: instant(value.end), location: isRecord(value.location) && typeof value.location.displayName === "string" ? value.location.displayName : "" };
}
function wallTime(iso: string, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
