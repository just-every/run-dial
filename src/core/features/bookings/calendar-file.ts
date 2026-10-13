import type { BookingRecord } from "./types";

export function bookingIcs(booking: BookingRecord) {
  const cancelled = booking.state === "cancelled";
  return calendarFile({
    uid: booking.icalUid, sequence: booking.occurrence.sequence + (cancelled ? 1 : 0), cancelled,
    updatedAt: booking.updatedAt, startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt,
    title: booking.eventTitle,
    location: booking.locationType === "google_meet" ? booking.meetingUrl ?? booking.locationLabel : booking.locationValue,
  });
}

export function initialBookingIcs(input: { bookingId: string; eventTitle: string; startAt: string; endAt: string; location: string; createdAt: string }) {
  return calendarFile({ uid: `dial-${input.bookingId}@dial`, sequence: 0, cancelled: false,
    updatedAt: input.createdAt, startAt: input.startAt, endAt: input.endAt, title: input.eventTitle, location: input.location });
}

function calendarFile(input: { uid: string; sequence: number; cancelled: boolean; updatedAt: string; startAt: string; endAt: string; title: string; location: string }) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dial//Booking//EN", `METHOD:${input.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT", `UID:${text(input.uid)}`, `SEQUENCE:${input.sequence}`, `DTSTAMP:${instant(input.updatedAt)}`,
    `DTSTART:${instant(input.startAt)}`, `DTEND:${instant(input.endAt)}`, `SUMMARY:${text(input.title)}`, `LOCATION:${text(input.location)}`,
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
