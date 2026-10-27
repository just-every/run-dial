import { ProviderFailure, type BusyInterval } from "./types";
import { isRecord } from "./google-wire";

/** Graph schedule lookup uses SMTP mailbox addresses, while secondary calendars require calendarView. */
export async function microsoftBusy({ input, json, collection }: {
  accessToken: string;
  input: { calendarIds: string[]; startsAt: string; endsAt: string; timeZone: string };
  json(url: string, init?: RequestInit): Promise<Record<string, unknown>>;
  collection(url: string): Promise<Record<string, unknown>[]>;
}) {
  if (!input.calendarIds.length) throw new ProviderFailure("invalid_provider_response", false);
  const intervals: BusyInterval[] = [];
  for (const calendarId of input.calendarIds) {
    const calendar = await json(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}?$select=id,isDefaultCalendar,owner`);
    if (calendar.id !== calendarId || typeof calendar.isDefaultCalendar !== "boolean") throw new ProviderFailure("invalid_provider_response", false);
    const owner = isRecord(calendar.owner) ? calendar.owner.address : undefined;
    if (calendar.isDefaultCalendar === true) {
      if (typeof owner !== "string") throw new ProviderFailure("invalid_provider_response", false);
      const body = await json("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schedules: [owner], startTime: { dateTime: input.startsAt, timeZone: "UTC" }, endTime: { dateTime: input.endsAt, timeZone: "UTC" }, availabilityViewInterval: 5 }) });
      if (!Array.isArray(body.value) || body.value.length !== 1 || !isRecord(body.value[0]) || body.value[0].scheduleId !== owner || body.value[0].error || !Array.isArray(body.value[0].scheduleItems)) throw new ProviderFailure("invalid_provider_response", false);
      for (const event of body.value[0].scheduleItems) {
        if (!isRecord(event)) throw new ProviderFailure("invalid_provider_response", false);
        if (event.status !== "free") intervals.push(interval(calendarId, event));
      }
    } else {
      const url = new URL(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView`);
      url.searchParams.set("startDateTime", input.startsAt); url.searchParams.set("endDateTime", input.endsAt); url.searchParams.set("$select", "id,start,end,showAs,isCancelled");
      for (const event of await collection(url.toString())) if (event.isCancelled !== true && event.showAs !== "free") intervals.push(interval(calendarId, event));
    }
  }
  return { observedAt: new Date().toISOString(), intervals };
}
function interval(calendarId: string, value: Record<string, unknown>): BusyInterval {
  const startsAt = instant(value.start), endsAt = instant(value.end);
  if (startsAt >= endsAt) throw new ProviderFailure("invalid_provider_response", false);
  return { calendarId, startsAt, endsAt, transparency: "opaque", deleted: false };
}
export function instant(value: unknown) {
  if (!isRecord(value) || typeof value.dateTime !== "string" || (value.timeZone !== "UTC" && value.timeZone !== "Etc/UTC")) throw new ProviderFailure("invalid_provider_response", false);
  const time = Date.parse(value.dateTime.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value.dateTime) ? value.dateTime : value.dateTime + "Z");
  if (!Number.isFinite(time)) throw new ProviderFailure("invalid_provider_response", false);
  return new Date(time).toISOString();
}
