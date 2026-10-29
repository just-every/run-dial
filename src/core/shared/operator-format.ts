/** Compact operator dates; the surrounding section states the time zone once. */
export function operatorDateTime(value: string, timezone = "UTC", referenceInstant = new Date().toISOString()) {
  const parts = localParts(value, timezone);
  return `${dateLabel(parts, timezone, referenceInstant)}, ${clockLabel(parts, true, repeatedOffset(value, timezone))}`;
}

export function operatorTimeRange(start: string | null, end: string | null, timezone: string, includeDate = true) {
  if (!start || !end) return `${start ? operatorDateTime(start, timezone) : "Start not provided"}-${end ? operatorDateTime(end, timezone) : "end not provided"}`;
  const first = localParts(start, timezone), last = localParts(end, timezone);
  const sameDay = first.year === last.year && first.month === last.month && first.day === last.day;
  const firstOffset = repeatedOffset(start, timezone), lastOffset = repeatedOffset(end, timezone);
  if (!sameDay) return `${dateLabel(first, timezone)}, ${clockLabel(first, true, firstOffset)}-${dateLabel(last, timezone)}, ${clockLabel(last, true, lastOffset)}`;
  return `${includeDate ? `${dateLabel(first, timezone)}, ` : ""}${clockLabel(first, Boolean(firstOffset || lastOffset) || first.dayPeriod !== last.dayPeriod, firstOffset)}-${clockLabel(last, true, lastOffset)}`;
}

export function operatorTimestamp(value: string, timezone = "UTC", referenceInstant?: string) {
  return operatorDateTime(value, timezone, referenceInstant);
}

function localParts(value: string, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
}

function dateLabel(parts: Record<string, string>, timezone: string, referenceInstant = new Date().toISOString()) {
  const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date(referenceInstant));
  return `${parts.weekday} ${parts.day} ${parts.month}${parts.year === currentYear ? "" : ` ${parts.year}`}`;
}

function clockLabel(parts: Record<string, string>, includePeriod = true, offset = "") {
  return `${parts.hour}${parts.minute === "00" ? "" : `:${parts.minute}`}${includePeriod ? ` ${parts.dayPeriod}` : ""}${offset ? ` ${offset}` : ""}`;
}

/** Identify both occurrences of a repeated wall clock without labelling ordinary DST days. */
function repeatedOffset(value: string, timezone: string) {
  const instant = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const parts = (date: Date) => formatter.formatToParts(date);
  const wall = (values: Intl.DateTimeFormatPart[]) => values.filter(part => part.type !== "timeZoneName").map(part => part.value).join("");
  const offset = (values: Intl.DateTimeFormatPart[]) => values.find(part => part.type === "timeZoneName")!.value;
  const current = parts(instant);
  for (const hours of [-1, 1]) {
    const neighbour = parts(new Date(instant.getTime() + hours * 3_600_000));
    if (offset(current) !== offset(neighbour) && wall(current) === wall(neighbour)) return offset(current);
  }
  return "";
}
