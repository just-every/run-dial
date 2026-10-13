import { managedChangeFrom } from "./google-managed-events";
import type { ManagedEventInspection } from "./types";

const projection = "id,status,updated,start,end,location,extendedProperties/private";

/** A fresh snapshot resolves a wake-up, never supplies a made-up deletion timestamp. */
export async function inspectGoogleManagedEvent(input: {
  calendarApi: string;
  calendarId: string;
  bookingId: string;
  providerEventId: string;
  readEvent(url: URL): Promise<Record<string, unknown> | undefined>;
  readList(url: URL): Promise<Record<string, unknown>>;
}): Promise<ManagedEventInspection> {
  const eventUrl = new URL(`${input.calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.providerEventId)}`);
  eventUrl.searchParams.set("fields", projection);
  const event = await input.readEvent(eventUrl);
  // A missing object may be purged or inaccessible; absence alone gives no ordering proof.
  if (!event) return { kind: "unresolved", code: "event_missing" };
  if (event.id !== input.providerEventId) return { kind: "unresolved", code: "identity_missing" };
  if (event.status !== "cancelled") {
    const fact = managedChangeFrom(event);
    return fact?.kind === "changed" && fact.bookingId === input.bookingId
      ? { kind: "present", event: fact }
      : { kind: "unresolved", code: "identity_missing" };
  }
  const listUrl = new URL(`${input.calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events`);
  listUrl.searchParams.set("privateExtendedProperty", `dial-booking-id=${input.bookingId}`);
  listUrl.searchParams.set("showDeleted", "false");
  listUrl.searchParams.set("maxResults", "2");
  listUrl.searchParams.set("fields", `kind,items(${projection}),nextPageToken`);
  const body = await input.readList(listUrl);
  if (body.kind !== "calendar#events" || body.nextPageToken || (body.items !== undefined && !Array.isArray(body.items))) return { kind: "unresolved", code: "ambiguous_events" };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 1) return { kind: "unresolved", code: "ambiguous_events" };
  if (!items.length) return { kind: "deleted", providerEventId: input.providerEventId };
  const replacement = managedChangeFrom(items[0]);
  return replacement?.kind === "changed" && replacement.bookingId === input.bookingId
    ? { kind: "present", event: replacement }
    : { kind: "unresolved", code: "identity_missing" };
}
