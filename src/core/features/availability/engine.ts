import { isSameGroupSlot } from "../group-events";
import { datePlus, hostDateAt, offsetMinutesAt, zonedOffsetLabel, zonedParts } from "./timezone";

import { horizonAllows } from "../../shared/booking-horizon";
import { windowsForDate } from "./windows";
import { fitsWindow, windowSpans } from "./window-spans";
import type { BookingLimitExclusion } from "./booking-limits";
export { rankSlots, buildRecommendationContext } from "./recommendations";

export type AvailabilityWindow = { weekday: number; startMinute: number; endMinute: number };
export type DateOverride = { hostDate: string; mode: "open" | "closed"; windows: Array<{ startMinute: number; endMinute: number }> };
export type BusyInterval = { startAt: string; endAt: string };
export type InternalClaim = BusyInterval & { eventTypeId?: string | null; hostDate: string; bookingStartAt?: string; bookingEndAt?: string };
export type AvailabilityConstraints = {
  durationMinutes: number;
  slotIncrementMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  bookingHorizonMode?: "calendar_days" | "weekdays" | "fixed_range" | "indefinite";
  bookingStartDate?: string | null;
  bookingEndDate?: string | null;

  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  hostDayBookingLimit: number | null;
  eventTypeId?: string;
  groupCapacity?: number | null;
  enforceMinimumNotice?: boolean;
  enforceHorizon?: boolean;
};
export type AvailableSlot = {
  startAt: string;
  endAt: string;
  hostDate: string;
  hostOffset: string;
};
export type SlotExclusion =
  | "schedule"
  | "date_override"
  | "start_increment"
  | "minimum_notice"
  | "horizon"
  | "buffer"
  | "host_day_limit"
  | "dial_booking"
  | "calendar_busy"
  | BookingLimitExclusion;
export type SlotEvaluation = { valid: boolean; exclusions: SlotExclusion[] };

export type SlotEngineInput = {
  additionalExclusions?: (startAt: string, endAt: string) => BookingLimitExclusion[];
  hostTimeZone: string;
  recurringWindows: AvailabilityWindow[];
  overrides: DateOverride[];
  constraints: AvailabilityConstraints;
  fromHostDate: string;
  days: number;
  now?: Date;
  internalClaims: InternalClaim[];
  calendarBusy: BusyInterval[];
};

/** Pure, UTC-first schedule arithmetic. Provider I/O and persistence stay outside it. */
export function listAvailableSlots(input: SlotEngineInput): AvailableSlot[] {
  const now = input.now ?? new Date();
  const result: AvailableSlot[] = [];
  for (let day = 0; day < input.days; day += 1) {
    const hostDate = datePlus(input.fromHostDate, day);
    const windows = windowsForDate(input.recurringWindows, input.overrides, hostDate);
    const timelines = windowSpans(hostDate, input.hostTimeZone, windows, input.constraints.slotIncrementMinutes);
    for (const window of windows) {
      const timeline = timelines.get(window)!;
      for (const instant of timeline.starts) {
        const start = new Date(instant);
        const end = new Date(instant + input.constraints.durationMinutes * 60_000);
        const fits = fitsWindow(timeline.spans, start, end);
        // Starts were aligned to this original window during the UTC scan.
        const evaluation = evaluateCandidate(input, hostDate, start, end, now, window, fits, true);
        if (evaluation.valid) result.push({ startAt: start.toISOString(), endAt: end.toISOString(), hostDate, hostOffset: zonedOffsetLabel(start, input.hostTimeZone) });
      }
    }
  }
  return [...new Map(result.map((slot) => [slot.startAt, slot])).values()].sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export function evaluateSlot(
  input: Omit<SlotEngineInput, "fromHostDate" | "days">,
  hostDate: string,
  minuteOfDay: number,
  start: Date,
  end: Date,
  now = new Date(),
  expectedWindow?: { startMinute: number; endMinute: number },
): SlotEvaluation {
  const windows = windowsForDate(input.recurringWindows, input.overrides, hostDate);
  const spans = windowSpans(hostDate, input.hostTimeZone, windows);
  const matching = windows.filter((window) => minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute && (!expectedWindow || window.startMinute === expectedWindow.startMinute && window.endMinute === expectedWindow.endMinute));
  const fitting = matching.filter((window) => fitsWindow(spans.get(window)!.spans, start, end));
  const window = fitting.find((candidate) => (minuteOfDay - candidate.startMinute) % input.constraints.slotIncrementMinutes === 0) ?? fitting[0] ?? matching[0];
  const onMinute = zonedParts(start, input.hostTimeZone).second === 0 && start.getUTCMilliseconds() === 0;
  return evaluateCandidate(input, hostDate, start, end, now, window, Boolean(window && fitting.includes(window)), Boolean(window && onMinute && (minuteOfDay - window.startMinute) % input.constraints.slotIncrementMinutes === 0));
}

function evaluateCandidate(
  input: Omit<SlotEngineInput, "fromHostDate" | "days">,
  hostDate: string, start: Date, end: Date, now: Date,
  window: { startMinute: number; endMinute: number } | undefined,
  durationFits: boolean, startAligned: boolean,
): SlotEvaluation {
  const exclusions: SlotExclusion[] = [];
  exclusions.push(...input.additionalExclusions?.(start.toISOString(), end.toISOString()) ?? []);
  if (!window || !durationFits) exclusions.push(input.overrides.some((override) => override.hostDate === hostDate) ? "date_override" : "schedule");
  if (window && !startAligned) exclusions.push("start_increment");

  if (input.constraints.enforceMinimumNotice !== false) {
    const minimumStart = now.getTime() + input.constraints.minimumNoticeMinutes * 60_000;
    if (start.getTime() < minimumStart) exclusions.push("minimum_notice");
  }
  if (input.constraints.enforceHorizon !== false) {
    if (!horizonAllows(input.constraints, hostDate, hostDateAt(now, input.hostTimeZone))) exclusions.push("horizon");
  }

  const occupiedStart = start.getTime() - input.constraints.beforeBufferMinutes * 60_000;
  const occupiedEnd = end.getTime() + input.constraints.afterBufferMinutes * 60_000;
  const placement = { eventId: input.constraints.eventTypeId ?? "", startAt: start.toISOString(), endAt: end.toISOString(), occupiedStartAt: new Date(occupiedStart).toISOString(), occupiedEndAt: new Date(occupiedEnd).toISOString() };
  const ownSeats = input.constraints.groupCapacity == null ? [] : input.internalClaims.filter(claim => isSameGroupSlot(claim, placement));
  const overlapsClaim = ownSeats.length >= (input.constraints.groupCapacity ?? 1)
    || input.internalClaims.some(claim => !ownSeats.includes(claim) && overlaps(occupiedStart, occupiedEnd, Date.parse(claim.startAt), Date.parse(claim.endAt)));
  const overlapsBusy = input.calendarBusy.some((interval) => overlaps(occupiedStart, occupiedEnd, Date.parse(interval.startAt), Date.parse(interval.endAt)));
  if (overlapsClaim) exclusions.push("dial_booking");
  if (overlapsBusy) exclusions.push("calendar_busy");
  const bufferHitsClaim = overlapsClaim && input.internalClaims.some((claim) => overlaps(occupiedStart, occupiedEnd, Date.parse(claim.startAt), Date.parse(claim.endAt)) && !overlaps(start.getTime(), end.getTime(), Date.parse(claim.bookingStartAt ?? claim.startAt), Date.parse(claim.bookingEndAt ?? claim.endAt)));
  const bufferHitsBusy = overlapsBusy && input.calendarBusy.some((interval) => overlaps(occupiedStart, occupiedEnd, Date.parse(interval.startAt), Date.parse(interval.endAt)) && !overlaps(start.getTime(), end.getTime(), Date.parse(interval.startAt), Date.parse(interval.endAt)));
  if (bufferHitsClaim || bufferHitsBusy) exclusions.push("buffer");
  if (input.constraints.hostDayBookingLimit !== null && input.internalClaims.filter((claim) => claim.hostDate === hostDate).length >= input.constraints.hostDayBookingLimit) exclusions.push("host_day_limit");

  return { valid: exclusions.length === 0, exclusions };
}

function overlaps(startOne: number, endOne: number, startTwo: number, endTwo: number) {
  return startOne < endTwo && endOne > startTwo;
}

export function hostDateForInstant(instant: string, hostTimeZone: string) {
  return hostDateAt(new Date(instant), hostTimeZone);
}

export function offsetMinutesForInstant(instant: string, timeZone: string) {
  return offsetMinutesAt(new Date(instant), timeZone);
}
