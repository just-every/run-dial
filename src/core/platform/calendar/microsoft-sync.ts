import { ProviderFailure, type ManagedCalendarChange, type ManagedCalendarSync } from "./types";
import { graphBase, isRecord, type MicrosoftWire } from "./microsoft-wire";
import { eventExpansion, microsoftChange } from "./microsoft-events";
export async function microsoftSync(wire: MicrosoftWire, token: string, calendarId: string, cursor?: string): Promise<ManagedCalendarSync> {
  // Graph v1.0 delta is a calendarView with a fixed range; the cursor preserves
  // that range. Connections need a full renewal to move the window.
  const url = new URL(`${graphBase}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`);
  url.searchParams.set("startDateTime", new Date(Date.now() - 366 * 86400000).toISOString());
  url.searchParams.set("endDateTime", new Date(Date.now() + 5 * 366 * 86400000).toISOString());
  let next: string | undefined = cursor ?? url.toString(); const seen = new Set<string>(), changes: ManagedCalendarChange[] = [];
  while (next) {
    if (seen.has(next) || seen.size >= 100) throw new ProviderFailure("invalid_provider_response", false);
    seen.add(next); const body = await wire.json(token, next);
    if (!Array.isArray(body.value)) throw new ProviderFailure("invalid_provider_response", false);
    for (const item of body.value) {
      if (!isRecord(item) || typeof item.id !== "string") throw new ProviderFailure("invalid_provider_response", false);
      // Delta does not support $expand. Hydrate live entries before extracting our private identity.
      const event = isRecord(item["@removed"]) ? item : await wire.optional(token, `${graphBase}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(item.id)}?$expand=${encodeURIComponent(eventExpansion)}`);
      if (!event) continue;
      const change = microsoftChange(event); if (change) changes.push(change);
    }
    if (typeof body["@odata.nextLink"] === "string") next = body["@odata.nextLink"];
    else {
      if (typeof body["@odata.deltaLink"] !== "string") throw new ProviderFailure("invalid_provider_response", false);
      return { changes, syncCursor: body["@odata.deltaLink"] };
    }
  }
  throw new ProviderFailure("invalid_provider_response", false);
}
