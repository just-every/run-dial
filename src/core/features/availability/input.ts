import type { EventTypeRecord, EventTypesService } from "../event-types";
import type { AvailabilityRepository } from "./repository";
import type { CalendarBusyReader } from "./service";
import type { SlotEngineInput } from "./engine";
import { datePlus, firstInstantOfHostDate } from "./timezone";
import { endOfHostDate } from "./date-bounds";
import { withoutIntervals } from "./intervals";

export type OperatorAvailabilityOptions = { overrideNoticeAndHorizon: boolean; overridePublishedAvailability?: boolean; includeRecommendations?: boolean };
/** One authoritative, bounded read context for offers, selection and private diagnostics. */
export async function loadAvailabilityInput(
  dependencies: { repository: AvailabilityRepository; calendar: CalendarBusyReader; eventTypes: EventTypesService },
  event: EventTypeRecord, hostTimeZone: string, firstDate: string, days: number,
  now: Date, freshness: "cached" | "fresh", operatorOverride: OperatorAvailabilityOptions,
  excludedBookingId?: string,
) {
  if (event.requestOnly) return undefined;
  const rangeStart = firstInstantOfHostDate(firstDate, hostTimeZone);
  const rangeEnd = endOfHostDate(datePlus(firstDate, days - 1), hostTimeZone);
  if (!rangeStart || !rangeEnd) return undefined;
  const busyStart = new Date(rangeStart.getTime() - event.beforeBufferMinutes * 60_000).toISOString();
  const busyEnd = new Date(rangeEnd.getTime() + event.afterBufferMinutes * 60_000).toISOString();
  const [busy, internalClaims, overrides] = await Promise.all([
    dependencies.calendar.readBusy({ startAt: busyStart, endAt: busyEnd, freshness }),
    dependencies.repository.listInternalClaims(busyStart, busyEnd, excludedBookingId, event.hostDayBookingLimit === null ? [] : Array.from({ length: days }, (_, day) => datePlus(firstDate, day))),
    dependencies.eventTypes.listDateAvailabilityOverrides(event.id),
  ]);
  if (busy.kind !== "ok" || !overrides || (event.locationType === "google_meet" && busy.calendarRequired === false)) return undefined;
  const ownEvents = await dependencies.repository.listOwnCalendarEvents(busyStart, busyEnd, busy.observedAt);
  const input: SlotEngineInput = {
    hostTimeZone,
    recurringWindows: operatorOverride.overridePublishedAvailability ? allDayWindows : event.availability,
    overrides: operatorOverride.overridePublishedAvailability ? [] : overrides,
    constraints: {
      durationMinutes: event.durationMinutes,
      slotIncrementMinutes: operatorOverride.overridePublishedAvailability ? 1 : event.slotIncrementMinutes,
      minimumNoticeMinutes: event.minimumNoticeMinutes,
      bookingHorizonDays: event.bookingHorizonDays,
      beforeBufferMinutes: event.beforeBufferMinutes,
      afterBufferMinutes: event.afterBufferMinutes,
      hostDayBookingLimit: event.hostDayBookingLimit,
      enforceMinimumNotice: !operatorOverride.overrideNoticeAndHorizon,
      enforceHorizon: !operatorOverride.overrideNoticeAndHorizon,
    },
    fromHostDate: firstDate,
    days,
    now,
    internalClaims,
    // Dial's own managed events read back from the conflict calendars are bookings, not external busy time: the
    // internal claims hold live bookings, and a cancelled or moved booking's old event must not keep its time blocked.
    calendarBusy: withoutIntervals(busy.intervals, ownEvents),
  };
  return { input, calendarRequired: busy.calendarRequired !== false, range: { start: rangeStart.getTime(), end: rangeEnd.getTime() } };
}
const allDayWindows = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
