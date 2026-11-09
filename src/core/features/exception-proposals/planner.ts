import type { RequestedWindow } from "../availability-requests";
import { evaluateSlot, listAvailableSlots, datePlus, hostDateAt, weekdayForDate, zonedParts, fitsWindow, windowSpans,
  type SlotEngineInput, type NamedSchedule } from "../availability";

type Windows = SlotEngineInput["recurringWindows"];
export type InviteeSpan = { window: RequestedWindow; spans: Array<{ start: number; end: number }> };

/** Reuse contiguous UTC spans so neither a fold nor a skipped hour widens a stored window. */
export function inviteeSpans(windows: RequestedWindow[], zone: string): InviteeSpan[] {
  return windows.map(window => ({ window, spans: windowSpans(window.date, zone, [window]).get(window)!.spans }));
}

export function requestedHostDates(windows: InviteeSpan[], zone: string) {
  const dates = new Set<string>();
  for (const { spans } of windows) for (const span of spans) {
    const first = hostDateAt(new Date(span.start), zone), last = hostDateAt(new Date(span.end - 1), zone);
    for (let date = first; date <= last; date = datePlus(date, 1)) dates.add(date);
  }
  return [...dates].sort();
}

/** Relax only recurring event hours. Every other native exclusion remains in the loaded input. */
export function planExceptionDay(input: SlotEngineInput, host: NamedSchedule, published: Windows, windows: InviteeSpan[], hostOverrides: SlotEngineInput["overrides"]) {
  const hostInput = { ...input, recurringWindows: host.windows, overrides: hostOverrides };
  const hostSlots = new Set(listAvailableSlots(hostInput).map(slot => slot.startAt));
  return listAvailableSlots({ ...input, recurringWindows: host.windows }).flatMap(slot => {
    if (!hostSlots.has(slot.startAt)) return [];
    const start = new Date(slot.startAt), end = new Date(slot.endAt);
    const requested = windows.find(window => fitsWindow(window.spans, start, end));
    if (!requested) return [];
    const local = zonedParts(start, input.hostTimeZone);
    const ordinary = evaluateSlot({ ...input, recurringWindows: published, overrides: [] }, slot.hostDate, local.hour * 60 + local.minute, start, end, input.now);
    if (!ordinary.exclusions.includes("schedule")) return [];
    const hours = host.windows.find(window => window.weekday === weekdayForDate(slot.hostDate)
      && fitsWindow(windowSpans(slot.hostDate, input.hostTimeZone, [window]).get(window)!.spans, start, end));
    if (!hours) return [];
    return [{ ...slot, tradeOff: {
      kind: "outside_event_recurring_hours" as const,
      publishedWindows: published.filter(window => window.weekday === weekdayForDate(slot.hostDate)),
      hostHours: { scheduleId: host.id, startMinute: hours.startMinute, endMinute: hours.endMinute },
      inviteeWindow: requested.window,
    } }];
  });
}
