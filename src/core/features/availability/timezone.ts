export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, created);
  return created;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function hostDateAt(instant: Date, timeZone: string) {
  const parts = zonedParts(instant, timeZone);
  return dateString(parts.year, parts.month, parts.day);
}

export function offsetMinutesAt(instant: Date, timeZone: string) {
  const parts = zonedParts(instant, timeZone);
  const displayedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((displayedUtc - instant.getTime()) / 60_000);
}

/**
 * Resolves a host wall-clock minute into every matching UTC instant. A spring-forward
 * gap has no result; an autumn fold has two results with distinct offsets. We obtain
 * the surrounding offsets from Intl and confirm every candidate by formatting it back
 * into the requested zone, rather than trusting a host-machine timezone.
 */
export function wallClockInstants(hostDate: string, minuteOfDay: number, timeZone: string) {
  const [year, month, day] = hostDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay, 0));
  const target: ZonedParts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: 0,
  };
  const naiveUtc = shifted.getTime();
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetMinutesAt(new Date(naiveUtc + hours * 60 * 60 * 1000), timeZone));
  }
  return [...offsets]
    .map((offset) => new Date(naiveUtc - offset * 60_000))
    .filter((candidate) => sameParts(zonedParts(candidate, timeZone), target))
    .sort((left, right) => left.getTime() - right.getTime());
}

/** The first actual UTC instant in a named local day, or undefined when that civil day was skipped. */
export function firstInstantOfHostDate(hostDate: string, timeZone: string) {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const candidates = wallClockInstants(hostDate, minute, timeZone);
    if (candidates.length > 0) return candidates[0];
  }
  return undefined;
}

export function datePlus(hostDate: string, days: number) {
  const [year, month, day] = hostDate.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return dateString(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

export function weekdayForDate(hostDate: string) {
  const [year, month, day] = hostDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function zonedOffsetLabel(instant: Date, timeZone: string) {
  const offset = offsetMinutesAt(instant, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function sameParts(left: ZonedParts, right: ZonedParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function dateString(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
