import { calendarLocalInstant, lockedCalendarZoneLines } from "./locked-calendar-zone";
import { hostDateForInstant, wallClockInstants, zonedParts } from "../availability";
import { formatTimeRange } from "../delivery/mail";
import type { BookingRecord } from "./types";

export function bookingIcs(booking: BookingRecord) {
  const cancelled = booking.state === "cancelled";
  return calendarFile({
    uid: booking.icalUid, sequence: booking.occurrence.sequence + (cancelled ? 1 : 0), cancelled,
    updatedAt: booking.updatedAt, startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt,
    lockedTimezone: booking.lockedTimezone,
    title: booking.eventTitle,
    location: cancelled && booking.locationType === "microsoft_teams" ? booking.locationLabel : (booking.locationType === "google_meet" || booking.locationType === "microsoft_teams") ? booking.meetingUrl ?? booking.locationLabel : booking.locationValue,
  });
}

export function initialBookingIcs(input: { bookingId: string; lockedTimezone?: string; eventTitle: string; startAt: string; endAt: string; location: string; createdAt: string }) {
  return calendarFile({ lockedTimezone: input.lockedTimezone, uid: `dial-${input.bookingId}@dial`, sequence: 0, cancelled: false,
    updatedAt: input.createdAt, startAt: input.startAt, endAt: input.endAt, title: input.eventTitle, location: input.location });
}

function calendarFile(input: { lockedTimezone?: string; uid: string; sequence: number; cancelled: boolean; updatedAt: string; startAt: string; endAt: string; title: string; location: string }) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dial//Booking//EN", `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    ...(input.lockedTimezone ? lockedCalendarZoneLines(input.lockedTimezone, input.startAt, input.endAt) : []),
    "BEGIN:VEVENT", `UID:${text(input.uid)}`, `SEQUENCE:${input.sequence}`, `DTSTAMP:${instant(input.updatedAt)}`,
    ...eventTimes(input.startAt, input.endAt, input.lockedTimezone), `SUMMARY:${text(input.title)}`, `LOCATION:${text(input.location)}`,
    ...(input.cancelled ? ["STATUS:CANCELLED"] : []), "END:VEVENT", "END:VCALENDAR"]
    .map(fold).join("\r\n") + "\r\n";
}

/** UTC DATE-TIME has second precision; never emit milliseconds or a floating local time. */
function instant(value: string) { return new Date(value).toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "") + "Z"; }
function text(value: string) {
  return value.replace(/\r\n|\r|\n/g, "\n").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}
/** RFC5545 folds at 75 UTF-8 octets including the continuation space. */
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "", length = 0;
  for (const character of line) {
    const size = encoder.encode(character).byteLength;
    if (length + size > 75) { result += "\r\n "; length = 1; }
    result += character; length += size;
  }
  return result;
}

function eventTimes(startAt: string, endAt: string, zone?: string): string[] {
  if (!zone) return [`DTSTART:${instant(startAt)}`, `DTEND:${instant(endAt)}`];
  const property = (name: string, at: string) => {
    const parts = zonedParts(new Date(at), zone);
    const matches = wallClockInstants(hostDateForInstant(at, zone), parts.hour * 60 + parts.minute, zone);
    // RFC5545 §3.3.5 always interprets an ambiguous local DATE-TIME as its first
    // occurrence. UTC encodes the later fold exactly; the description retains the location time.
    const laterFold = matches.length > 1 && Date.parse(at) >= matches[1].getTime();
    return laterFold ? `${name}:${instant(at)}` : `${name};TZID=${zone}:${calendarLocalInstant(at, zone)}`;
  };
  return [property("DTSTART", startAt), property("DTEND", endAt), `DESCRIPTION:${text(`Meeting time: ${formatTimeRange(startAt, endAt, zone, true)}`)}`];
}
