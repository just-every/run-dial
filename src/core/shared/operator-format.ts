/** Compact operator dates; the surrounding section states the time zone once. */
export function operatorDateTime(value: string, timezone = "UTC") {
  const parts = localParts(value, timezone);
  return `${dateLabel(parts, timezone)}, ${clockLabel(parts)}`;
}

export function operatorTimeRange(start: string | null, end: string | null, timezone: string) {
  if (!start || !end) return `${start ? operatorDateTime(start, timezone) : "Start not provided"}-${end ? operatorDateTime(end, timezone) : "end not provided"}`;
  const first = localParts(start, timezone), last = localParts(end, timezone);
  const sameDay = first.year === last.year && first.month === last.month && first.day === last.day;
  if (!sameDay) return `${dateLabel(first, timezone)}, ${clockLabel(first)}-${dateLabel(last, timezone)}, ${clockLabel(last)}`;
  return `${dateLabel(first, timezone)}, ${clockLabel(first, first.dayPeriod !== last.dayPeriod)}-${clockLabel(last)}`;
}

export function operatorTimestamp(value: string, timezone = "UTC") {
  return operatorDateTime(value, timezone);
}

function localParts(value: string, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
}

function dateLabel(parts: Record<string, string>, timezone: string) {
  const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date());
  return `${parts.weekday} ${parts.day} ${parts.month}${parts.year === currentYear ? "" : ` ${parts.year}`}`;
}

function clockLabel(parts: Record<string, string>, includePeriod = true) {
  return `${parts.hour}${parts.minute === "00" ? "" : `:${parts.minute}`}${includePeriod ? ` ${parts.dayPeriod}` : ""}`;
}
