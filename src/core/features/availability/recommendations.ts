import { zonedParts, type ZonedParts } from "./timezone";
import { windowsForDate } from "./windows";
import type { AvailableSlot, SlotEngineInput } from "./engine";

type Interval = { start: number; end: number };
export type RecommendationContext = { free: Interval[]; working: Interval[]; inviteeZoneSubmitted: boolean };

/** Only the already-read schedule and occupancy range contributes to ranking. */
export function buildRecommendationContext(input: SlotEngineInput, range: { start: number; end: number }, inviteeTimeZone?: string): RecommendationContext {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) throw new Error("Recommendation context requires a valid UTC read range");
  const open: Interval[] = [], working: Interval[] = [];
  const dates = new Map<string, ReturnType<typeof windowsForDate>>();
  let openStart: number | undefined, workingStart: number | undefined;
  for (let instant = range.start; instant < range.end; instant += 60_000) {
    const date = new Date(instant);
    const host = zonedParts(date, input.hostTimeZone);
    const hostDate = String(host.year).padStart(4, "0") + "-" + String(host.month).padStart(2, "0") + "-" + String(host.day).padStart(2, "0");
    let windows = dates.get(hostDate);
    if (!windows) { windows = windowsForDate(input.recurringWindows, input.overrides, hostDate); dates.set(hostDate, windows); }
    const minute = host.hour * 60 + host.minute;
    const isOpen = windows.some((window) => minute >= window.startMinute && minute < window.endMinute);
    const invitee = inviteeTimeZone && inviteeTimeZone !== input.hostTimeZone ? zonedParts(date, inviteeTimeZone) : host;
    const isWorking = workingMinute(host) && (!inviteeTimeZone || workingMinute(invitee));
    if (isOpen && openStart === undefined) openStart = instant;
    if (!isOpen && openStart !== undefined) { open.push({ start: openStart, end: instant }); openStart = undefined; }
    if (isWorking && workingStart === undefined) workingStart = instant;
    if (!isWorking && workingStart !== undefined) { working.push({ start: workingStart, end: instant }); workingStart = undefined; }
  }
  if (openStart !== undefined) open.push({ start: openStart, end: range.end });
  if (workingStart !== undefined) working.push({ start: workingStart, end: range.end });
  const blockers = mergeIntervals([...input.calendarBusy, ...input.internalClaims].map((interval) => ({ start: Math.max(range.start, Date.parse(interval.startAt)), end: Math.min(range.end, Date.parse(interval.endAt)) })).filter((interval) => interval.end > interval.start));
  return { free: subtractIntervals(open, blockers), working, inviteeZoneSubmitted: Boolean(inviteeTimeZone) };
}

/** Offers are immutable inputs: ranking selects/reorders them and creates no new slot. */
export function rankSlots(slots: AvailableSlot[], context: RecommendationContext, limit = 5) {
  const unique = new Map(slots.map((slot) => [String(Date.parse(slot.startAt)) + "/" + String(Date.parse(slot.endAt)), slot]));
  const scored = [...unique.values()].map((slot) => {
    const start = Date.parse(slot.startAt), end = Date.parse(slot.endAt);
    const free = containing(context.free, start, end);
    const working = Boolean(containing(context.working, start, end));
    return { slot, start, end, working, freeMinutes: free ? (start - free.start + free.end - end) / 60_000 : 0 };
  }).sort((left, right) => right.freeMinutes - left.freeMinutes || left.start - right.start || left.end - right.end);
  // An ordinal lets the browser rank for its own zone without sending device
  // information or exposing the host's private occupancy intervals.
  return scored.map((score, freeTimeRank) => ({ ...score, freeTimeRank }))
    .sort((left, right) => Number(right.working) - Number(left.working) || left.freeTimeRank - right.freeTimeRank)
    .slice(0, limit).map(({ slot, working, freeMinutes, freeTimeRank }) => ({ ...slot, freeTimeRank, hasFreeTime: freeMinutes > 0, reason: working ? context.inviteeZoneSubmitted ? "Inside both working days" : "Inside host working day" : freeMinutes > 0 ? "More uninterrupted free time" : "Earliest available time" }));
}

function workingMinute(parts: ZonedParts) { return parts.hour >= 9 && parts.hour < 17; }
function containing(intervals: Interval[], start: number, end: number) {
  let low = 0, high = intervals.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const interval = intervals[middle];
    if (start < interval.start) high = middle - 1;
    else if (start >= interval.end) low = middle + 1;
    else return end <= interval.end ? interval : undefined;
  }
  return undefined;
}
function mergeIntervals(intervals: Interval[]) {
  const merged: Interval[] = [];
  for (const interval of intervals.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}
function subtractIntervals(open: Interval[], busy: Interval[]) {
  const free: Interval[] = [];
  let blocker = 0;
  for (const interval of open) {
    let cursor = interval.start;
    while (blocker < busy.length && busy[blocker].end <= cursor) blocker++;
    for (let index = blocker; index < busy.length && busy[index].start < interval.end; index++) {
      if (busy[index].start > cursor) free.push({ start: cursor, end: Math.min(busy[index].start, interval.end) });
      cursor = Math.max(cursor, busy[index].end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) free.push({ start: cursor, end: interval.end });
  }
  return free;
}
