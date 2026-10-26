/** Compact operator dates; the surrounding section states the time zone once. */
export function operatorDateTime(value: string, timezone = "UTC", referenceInstant = new Date().toISOString()) {
  const parts = localParts(value, timezone);
  return `${dateLabel(parts, timezone, referenceInstant)}, ${clockLabel(parts)}`;
}

export function operatorTimeRange(start: string | null, end: string | null, timezone: string, includeDate = true) {
  if (!start || !end) return `${start ? operatorDateTime(start, timezone) : "Start not provided"}-${end ? operatorDateTime(end, timezone) : "end not provided"}`;
  const first = localParts(start, timezone), last = localParts(end, timezone);
  const sameDay = first.year === last.year && first.month === last.month && first.day === last.day;
  if (!sameDay) return `${dateLabel(first, timezone)}, ${clockLabel(first)}-${dateLabel(last, timezone)}, ${clockLabel(last)}`;
  return `${includeDate ? `${dateLabel(first, timezone)}, ` : ""}${clockLabel(first, first.dayPeriod !== last.dayPeriod || !!first.timeZoneName)}-${clockLabel(last)}`;
}

export function operatorTimestamp(value: string, timezone = "UTC", referenceInstant?: string) {
  return operatorDateTime(value, timezone, referenceInstant);
}

function localParts(value: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const instant = new Date(value);
  const wallClock = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  });
  const offset = (date: Date) => new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, timeZoneName: "shortOffset",
  }).formatToParts(date).find(part => part.type === "timeZoneName")!.value;
  const currentOffset = offset(instant);
  const repeats = [-1, 1].some(direction => {
    const adjacent = new Date(instant.getTime() + direction * 60 * 60 * 1000);
    return offset(adjacent) !== currentOffset && wallClock.format(adjacent) === wallClock.format(instant);
  });
  if (repeats) parts.timeZoneName = currentOffset;
  return parts;
}

function dateLabel(parts: Record<string, string>, timezone: string, referenceInstant = new Date().toISOString()) {
  const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date(referenceInstant));
  return `${parts.weekday} ${parts.day} ${parts.month}${parts.year === currentYear ? "" : ` ${parts.year}`}`;
}

function clockLabel(parts: Record<string, string>, includePeriod = true) {
  return `${parts.hour}${parts.minute === "00" ? "" : `:${parts.minute}`}${includePeriod ? ` ${parts.dayPeriod}` : ""}${parts.timeZoneName ? ` ${parts.timeZoneName}` : ""}`;
}
