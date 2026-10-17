import type { ManagedCalendarChange, ManagedCalendarEvent, ManagedCalendarEventResult } from "./types";
import { ProviderFailure } from "./types";
import { isRecord } from "./google-wire";

export function googleEventPayload(event: ManagedCalendarEvent, conferenceExists: boolean, includeIcalUid: boolean) {
  return {
    ...(includeIcalUid ? { iCalUID: event.icalUid } : {}),
    summary: event.title,
    transparency: event.transparency ?? "opaque",
    description: event.description,
    location: event.location,
    start: { dateTime: event.startAt, timeZone: event.timeZone },
    end: { dateTime: event.endAt, timeZone: event.timeZone },
    attendees: [{ email: event.inviteeEmail }],
    extendedProperties: { private: { "dial-idempotency-key": event.idempotencyKey, "dial-booking-id": event.bookingId, "dial-occurrence-id": event.occurrenceId, "dial-ical-uid": event.icalUid } },
    ...(event.requestGoogleMeet && !conferenceExists
      ? { conferenceData: { createRequest: { requestId: event.idempotencyKey, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
}

export function managedResult(value: Record<string, unknown>): ManagedCalendarEventResult {
  if (typeof value.id !== "string" || typeof value.updated !== "string") throw new ProviderFailure("invalid_provider_response", false);
  const conferenceData = isRecord(value.conferenceData) ? value.conferenceData : undefined;
  const entryPoints = Array.isArray(conferenceData?.entryPoints) ? conferenceData.entryPoints : [];
  const video = entryPoints.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.entryPointType === "video" && typeof entry.uri === "string");
  const createRequest = isRecord(conferenceData?.createRequest) ? conferenceData.createRequest : undefined;
  const createStatus = isRecord(createRequest?.status) ? createRequest.status : undefined;
  const status = createStatus?.statusCode;
  return {
    providerEventId: value.id,
    providerUpdatedAt: value.updated,
    conferenceUrl: video?.uri as string | undefined,
    conferenceState: video ? "ready" : status === "pending" ? "pending" : status === "failure" ? "failed" : "not_requested",
  };
}

export function managedChangeFrom(value: unknown): ManagedCalendarChange | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return undefined;
  const properties = isRecord(value.extendedProperties) && isRecord(value.extendedProperties.private) ? value.extendedProperties.private : undefined;
  const bookingId = typeof properties?.["dial-booking-id"] === "string" ? properties["dial-booking-id"] : undefined;
  const occurrenceId = typeof properties?.["dial-occurrence-id"] === "string" ? properties["dial-occurrence-id"] : undefined;
  if (value.status === "cancelled") return {
    bookingId,
    occurrenceId,
    providerEventId: value.id,
    ...(normalisedDateTime(value.updated) ? { updatedAt: normalisedDateTime(value.updated) } : {}),
    kind: "deleted",
  };
  if (!bookingId || !occurrenceId) return undefined;
  const updatedAt = normalisedDateTime(value.updated);
  const startAt = eventDateTime(value.start);
  const endAt = eventDateTime(value.end);
  if (!updatedAt || !startAt || !endAt) return undefined;
  return { bookingId, occurrenceId, providerEventId: value.id, updatedAt, kind: "changed", startAt, endAt, location: typeof value.location === "string" ? value.location : "" };
}

function eventDateTime(value: unknown) {
  return isRecord(value) ? normalisedDateTime(value.dateTime) : undefined;
}

function normalisedDateTime(value: unknown) {
  if (typeof value !== "string") return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? undefined : instant.toISOString();
}
