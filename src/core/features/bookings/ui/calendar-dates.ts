export type CalendarMode = "day" | "week" | "month";
export function civilDate(instant: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validCalendarDate(date: string | null) {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date ? date : undefined;
}
export function civilPlus(date: string, days: number) { const next = new Date(date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0,10); }
export function calendarRange(anchor: string, mode: CalendarMode) {
  let from = anchor, through = anchor;
  if (mode === "month") { from = anchor.slice(0,7) + "-01"; const next = new Date(from + "T12:00:00Z"); next.setUTCMonth(next.getUTCMonth() + 1); through = civilPlus(next.toISOString().slice(0,10), -1); }
  if (mode !== "day") { from = civilPlus(from, -(new Date(from+"T12:00:00Z").getUTCDay()+6)%7); through = mode === "week" ? civilPlus(from,6) : civilPlus(through, 6-(new Date(through+"T12:00:00Z").getUTCDay()+6)%7); }
  const days: string[] = []; for (let day=from;day<=through;day=civilPlus(day,1)) days.push(day);
  return { from, through, days };
}
export function advanceCalendar(anchor: string, mode: CalendarMode, direction: number) {
  if (mode !== "month") return civilPlus(anchor, direction * (mode === "week" ? 7 : 1));
  const date = new Date(anchor.slice(0,7)+"-01T12:00:00Z"); date.setUTCMonth(date.getUTCMonth()+direction); return date.toISOString().slice(0,10);
}
export function civilLabel(date: string) { return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(new Date(date+"T12:00:00Z")); }
