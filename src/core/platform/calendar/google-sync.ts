import type { ManagedCalendarChange, ManagedCalendarSync } from "./types";
import { ProviderFailure } from "./types";
import { managedChangeFrom } from "./google-managed-events";

export async function syncGoogleManagedEvents(input: {
  calendarApi: string;
  calendarId: string;
  syncCursor?: string;
  readPage(url: URL): Promise<Record<string, unknown>>;
}): Promise<ManagedCalendarSync> {
  const changes: ManagedCalendarChange[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const url = new URL(`${input.calendarApi}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("fields", "items(id,status,updated,start,end,location,extendedProperties/private),nextPageToken,nextSyncToken");
    if (input.syncCursor) url.searchParams.set("syncToken", input.syncCursor);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await input.readPage(url);
    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      const change = managedChangeFrom(item);
      if (change) changes.push(change);
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    if (!pageToken && typeof body.nextSyncToken === "string") nextSyncToken = body.nextSyncToken;
  } while (pageToken);
  if (!nextSyncToken) throw new ProviderFailure("invalid_provider_response", false);
  return { changes, syncCursor: nextSyncToken };
}
