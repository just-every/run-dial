import type { BusyRead } from "./types";
import { ProviderFailure } from "./types";
import { isRecord } from "./google-wire";

export function busyReadFromGoogle(value: Record<string, unknown>, calendarIds: string[]): BusyRead {
  const calendars = isRecord(value.calendars) ? value.calendars : undefined;
  if (!calendars) throw new ProviderFailure("invalid_provider_response", false);
  const intervals = [];
  for (const calendarId of calendarIds) {
    const calendar = calendars[calendarId];
    if (!isRecord(calendar) || (Array.isArray(calendar.errors) && calendar.errors.length > 0)) throw new ProviderFailure("provider_unavailable", true);
    const busy = Array.isArray(calendar.busy) ? calendar.busy : undefined;
    if (!busy) throw new ProviderFailure("invalid_provider_response", false);
    for (const interval of busy) {
      if (!isRecord(interval) || typeof interval.start !== "string" || typeof interval.end !== "string") throw new ProviderFailure("invalid_provider_response", false);
      intervals.push({ calendarId, startsAt: interval.start, endsAt: interval.end, transparency: "opaque" as const, deleted: false });
    }
  }
  return { intervals, observedAt: new Date().toISOString() };
}
