function parts(value: string, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find(item => item.type === type)!.value;
  return { year: part("year"), month: part("month"), day: part("day"), weekday: part("weekday"), hour: part("hour"), minute: part("minute"), period: part("dayPeriod") };
}
function clock(value: ReturnType<typeof parts>, period = true) {
  return `${value.hour}${value.minute === "00" ? "" : `:${value.minute}`}${period ? ` ${value.period}` : ""}`;
}
function date(value: ReturnType<typeof parts>, timezone: string) {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date());
  return `${value.weekday} ${value.day} ${value.month}${value.year === year ? "" : ` ${value.year}`}`;
}
export function formatTime(value: string, timezone: string) { return clock(parts(value, timezone)); }
export function format(value: string, timezone: string) { const valueParts = parts(value, timezone); return `${date(valueParts, timezone)}, ${clock(valueParts)}`; }
export function formatRange(startAt: string, endAt: string, timezone: string) {
  const start = parts(startAt, timezone), end = parts(endAt, timezone);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  return sameDay ? `${date(start, timezone)}, ${clock(start, start.period !== end.period)}-${clock(end)}` : `${format(startAt, timezone)}-${format(endAt, timezone)}`;
}
export function formatDay(value: string) { return date(parts(`${value}T12:00:00Z`, "UTC"), "UTC"); }
export function formatWindow(dateValue: string, startMinute: number, endMinute: number) {
  const instant = (minute: number) => new Date(Date.parse(`${dateValue}T00:00:00Z`) + minute * 60_000).toISOString();
  return formatRange(instant(startMinute), instant(endMinute), "UTC");
}
