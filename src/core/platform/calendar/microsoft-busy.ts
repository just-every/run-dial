import { ProviderFailure, type BusyRead, type GoogleCalendarDescriptor } from "./types";
import { graphBase, graphInstant, graphPages, isRecord, type MicrosoftWire } from "./microsoft-wire";
export function microsoftDescriptor(value: unknown): GoogleCalendarDescriptor {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.canEdit !== "boolean") throw new ProviderFailure("invalid_provider_response", false);
  return { id: value.id, accessRole: value.canEdit ? "writer" : "reader", primary: value.isDefaultCalendar === true,
    conferenceCapable: Array.isArray(value.allowedOnlineMeetingProviders) && value.allowedOnlineMeetingProviders.includes("teamsForBusiness") };
}
export async function microsoftBusy(wire: MicrosoftWire, token: string, input: { calendarIds: string[]; startsAt: string; endsAt: string; timeZone: string }): Promise<BusyRead> {
  if (!input.calendarIds.length) throw new ProviderFailure("invalid_provider_response", false);
  const intervals: BusyRead["intervals"] = [];
  for (const calendarId of input.calendarIds) {
    const calendar = await wire.json(token, `${graphBase}/me/calendars/${encodeURIComponent(calendarId)}`);
    const address = isRecord(calendar.owner) && typeof calendar.owner.address === "string" ? calendar.owner.address : undefined;
    if (!address) throw new ProviderFailure("invalid_provider_response", false);
    // Graph getSchedule identifies mailboxes, not calendar IDs. Check the mailbox and
    // then read the selected calendar view so secondary calendars are not silently missed.
    const schedule = await wire.json(token, `${graphBase}/me/calendar/getSchedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schedules: [address], startTime: { dateTime: input.startsAt.replace(/Z$/, ""), timeZone: "UTC" }, endTime: { dateTime: input.endsAt.replace(/Z$/, ""), timeZone: "UTC" }, availabilityViewInterval: 5 }) });
    if (!Array.isArray(schedule.value) || schedule.value.length !== 1 || !isRecord(schedule.value[0]) || schedule.value[0].error || !Array.isArray(schedule.value[0].scheduleItems)) throw new ProviderFailure("provider_unavailable", true);
    const url = new URL(`${graphBase}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`);
    url.searchParams.set("startDateTime", input.startsAt); url.searchParams.set("endDateTime", input.endsAt); url.searchParams.set("$select", "id,start,end,showAs,isCancelled");
    for (const item of await graphPages(wire, token, url.toString())) {
      if (!isRecord(item) || typeof item.showAs !== "string" || typeof item.isCancelled !== "boolean") throw new ProviderFailure("invalid_provider_response", false);
      if (item.isCancelled || item.showAs === "free") continue;
      const startsAt = graphInstant(item.start), endsAt = graphInstant(item.end);
      if (startsAt >= endsAt) throw new ProviderFailure("invalid_provider_response", false);
      intervals.push({ calendarId, startsAt, endsAt, transparency: "opaque", deleted: false });
    }
  }
  return { intervals, observedAt: new Date().toISOString() };
}
