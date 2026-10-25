function parts(value: string, timezone: string) {
  const instant = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "shortOffset" });
  const values = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find(item => item.type === type)!.value;
  const offset = part("timeZoneName");
  const wallTime = (items: Intl.DateTimeFormatPart[]) => items.filter(item => item.type !== "timeZoneName").map(item => item.value).join("");
  // Try the surrounding offsets, then verify the other instant really has the
  // same wall time. This also covers folds whose clocks move by half an hour.
  const ambiguous = [-24, 24].some(hours => {
    const nearby = formatter.formatToParts(new Date(instant.getTime() + hours * 3_600_000));
    const otherOffset = nearby.find(item => item.type === "timeZoneName")!.value;
    if (otherOffset === offset) return false;
    const candidate = new Date(instant.getTime() + (offsetMinutes(offset) - offsetMinutes(otherOffset)) * 60_000);
    return wallTime(formatter.formatToParts(candidate)) === wallTime(values);
  });
  return { offset: ambiguous ? offset : "", year: part("year"), month: part("month"), day: part("day"), weekday: part("weekday"), hour: part("hour"), minute: part("minute"), period: part("dayPeriod") };
}
function offsetMinutes(offset: string) {
  if (offset === "GMT") return 0;
  const [, sign, hours, minutes = "0"] = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset)!;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}
function clock(value: ReturnType<typeof parts>, period = true) {
  return `${value.hour}${value.minute === "00" ? "" : `:${value.minute}`}${period ? ` ${value.period}` : ""}${value.offset ? ` ${value.offset}` : ""}`;
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
  const repeated = Boolean(start.offset || end.offset);
  return sameDay ? `${date(start, timezone)}, ${clock(start, repeated || start.period !== end.period)}${repeated ? " – " : "-"}${clock(end)}` : `${format(startAt, timezone)}-${format(endAt, timezone)}`;
}
export function formatDay(value: string) { return date(parts(`${value}T12:00:00Z`, "UTC"), "UTC"); }
export function formatWindow(dateValue: string, startMinute: number, endMinute: number) {
  const instant = (minute: number) => new Date(Date.parse(`${dateValue}T00:00:00Z`) + minute * 60_000).toISOString();
  return formatRange(instant(startMinute), instant(endMinute), "UTC");
}
