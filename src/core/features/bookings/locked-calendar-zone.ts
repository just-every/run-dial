import { zonedParts } from "../availability";
import { isCanonicalIanaTimeZone } from "../../shared/scheduling";

const second = 1000;
const day = 86_400 * second;
const cachedDefinitions = new Map<string, readonly string[]>();

/** A local DATE-TIME for a property whose TZID is the locked IANA zone. */
export function calendarLocalInstant(instant: string, zone: string): string {
  assertZone(zone);
  return localDateTime(parseInstant(instant), zone);
}

/** Calendar-level lines: insert before VEVENT and fold with the other ICS lines. */
export function lockedCalendarZoneLines(zone: string, startAt: string, endAt: string): string[] {
  assertZone(zone);
  const start = parseInstant(startAt);
  const end = parseInstant(endAt);
  if (end < start) throw new RangeError("Calendar end must not precede its start.");
  const firstYear = Math.min(start.getUTCFullYear(), zonedParts(start, zone).year) - 1;
  const lastYear = Math.max(end.getUTCFullYear(), zonedParts(end, zone).year) + 1;
  if (firstYear < 1 || lastYear > 9998) {
    throw new RangeError("Calendar timezone coverage must fit within four-digit years.");
  }
  const key = `${zone}:${firstYear}:${lastYear}`;
  const cached = cachedDefinitions.get(key);
  if (cached) return [...cached];

  const from = utcYearStart(firstYear);
  const until = utcYearStart(lastYear + 1);
  let previousOffset = offsetSecondsAt(from, zone);
  const lines = [
    `X-WR-TIMEZONE:${zone}`,
    "BEGIN:VTIMEZONE",
    `TZID:${zone}`,
    // Establish the offset before the first transition, including fixed-offset zones.
    ...observance(from, previousOffset, previousOffset),
  ];

  // IANA transitions are separated by more than a day. Sample at UTC-day
  // boundaries, then find the first changed second without rounding the offset.
  for (let lower = from; lower < until;) {
    const upper = Math.min(lower + day, until);
    const nextOffset = offsetSecondsAt(upper, zone);
    if (nextOffset !== previousOffset) {
      let before = lower / second;
      let after = upper / second;
      while (after - before > 1) {
        const middle = Math.floor((before + after) / 2);
        if (offsetSecondsAt(middle * second, zone) === previousOffset) before = middle;
        else after = middle;
      }
      lines.push(...observance(after * second, previousOffset, nextOffset));
    }
    previousOffset = nextOffset;
    lower = upper;
  }
  lines.push("END:VTIMEZONE");
  // Repeated downloads share pure computations without an unbounded Worker cache.
  if (cachedDefinitions.size >= 16) cachedDefinitions.delete(cachedDefinitions.keys().next().value!);
  cachedDefinitions.set(key, lines);
  return [...lines];
}

function assertZone(zone: string) {
  if (!isCanonicalIanaTimeZone(zone)) throw new RangeError(`Invalid canonical calendar timezone: ${zone}`);
}

function parseInstant(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const instant = new Date(value);
  if (!match || !Number.isFinite(instant.getTime()) || instant.getTime() % second !== 0) {
    throw new RangeError("Calendar instant must be an ISO date-time with an explicit offset and whole seconds.");
  }
  const [, year, month, date, hour, minute, seconds, , offset] = match;
  const local = new Date(0);
  local.setUTCFullYear(Number(year), Number(month) - 1, Number(date));
  if (Number(year) < 1 || local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month)
    || local.getUTCDate() !== Number(date) || Number(hour) > 23 || Number(minute) > 59 || Number(seconds) > 59
    || (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) {
    throw new RangeError("Calendar instant contains an invalid date, time or UTC offset.");
  }
  return instant;
}

function utcYearStart(year: number): number {
  const result = new Date(0);
  result.setUTCFullYear(year, 0, 1);
  return result.getTime();
}

function localDateTime(instant: Date, zone: string): string {
  const parts = zonedParts(instant, zone);
  if (parts.year < 1 || parts.year > 9999) throw new RangeError("Calendar local year must have four digits.");
  return `${String(parts.year).padStart(4, "0")}${digits(parts.month)}${digits(parts.day)}T${digits(parts.hour)}${digits(parts.minute)}${digits(parts.second)}`;
}

function offsetSecondsAt(milliseconds: number, zone: string): number {
  const parts = zonedParts(new Date(milliseconds), zone);
  const local = new Date(0);
  local.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  local.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return (local.getTime() - milliseconds) / second;
}

function observance(at: number, from: number, to: number): string[] {
  // RFC 5545 §3.6.5: onset uses the wall clock BEFORE the transition
  // (TZOFFSETFROM), not the post-transition local time returned by Intl.
  const onset = new Date(at + from * second).toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "");
  // Finite offset definitions need no inferred DST label: political changes,
  // negative DST and half-hour shifts all use the same exact offset semantics.
  return ["BEGIN:STANDARD", `DTSTART:${onset}`, `TZOFFSETFROM:${offsetValue(from)}`, `TZOFFSETTO:${offsetValue(to)}`, "END:STANDARD"];
}

function offsetValue(value: number): string {
  const absolute = Math.abs(value);
  return `${value < 0 ? "-" : "+"}${digits(Math.floor(absolute / 3600))}${digits(Math.floor(absolute % 3600 / 60))}${absolute % 60 ? digits(absolute % 60) : ""}`;
}

function digits(value: number): string { return String(value).padStart(2, "0"); }
