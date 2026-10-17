import { z } from "zod";
import { datePlus, firstInstantOfHostDate, hostDateAt, weekdayForDate } from "./timezone";

export type BookingLimitPeriod = { name: "day" | "week" | "month"; startAt: string; endAt: string };

export function bookingLimitBoundary(date: string, zone: string) {
  // A zone can skip a civil date entirely; that boundary is the following actual day.
  let instant = firstInstantOfHostDate(date, zone);
  for (let days = 1; !instant && days <= 7; days += 1) {
    instant = firstInstantOfHostDate(datePlus(date, days), zone);
  }
  if (!instant) throw new RangeError(`No timezone boundary for ${date} in ${zone}`);
  return instant.toISOString();
}

export function bookingLimitPeriods(day: string, zone: string): BookingLimitPeriod[] {
  z.iso.date().parse(day);
  const week = datePlus(day, -((weekdayForDate(day) + 6) % 7));
  const month = `${day.slice(0, 7)}-01`;
  const monthDate = new Date(`${month}T00:00:00.000Z`);
  const nextMonth = datePlus(month, new Date(Date.UTC(
    monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0,
  )).getUTCDate());
  const boundaries = new Map<string, string>();
  const boundary = (date: string) => {
    const existing = boundaries.get(date);
    if (existing) return existing;
    const result = bookingLimitBoundary(date, zone);
    boundaries.set(date, result);
    return result;
  };
  return [
    { name: "day", startAt: boundary(day), endAt: boundary(datePlus(day, 1)) },
    { name: "week", startAt: boundary(week), endAt: boundary(datePlus(week, 7)) },
    { name: "month", startAt: boundary(month), endAt: boundary(nextMonth) },
  ];
}

export function bookingLimitCandidate(
  eventId: string,
  zone: string,
  startAt: string,
  endAt: string,
  inviteeEmail?: string,
  excludedBookingId?: string,
) {
  z.string().min(1).parse(eventId);
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new RangeError("Booking limits require valid instants with end after start");
  }
  return {
    eventId,
    startMs: start.getTime(),
    endMs: end.getTime(),
    durationMs: end.getTime() - start.getTime(),
    inviteeEmail: inviteeEmail?.trim().toLowerCase() || null,
    excludedBookingId: excludedBookingId ?? null,
    periods: bookingLimitPeriods(hostDateAt(start, zone), zone),
  };
}
