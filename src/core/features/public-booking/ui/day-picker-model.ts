export type PickerSlot = { startAt: string; endAt: string; hostDate: string; hostOffset: string };
export type PickerAvailability = { state: "available"; week: string; slots: PickerSlot[]; recommendations: Array<PickerSlot & { reason: string }>; rankedSlots: Array<PickerSlot & { reason: string }> } | { state: "temporarily_unavailable"; provider: string; slots: [] };
export function dateInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function groupSlotsByDay(slots: PickerSlot[], timezone: string) {
  const groups = new Map<string, PickerSlot[]>();
  for (const slot of slots) {
    const date = dateInZone(slot.startAt, timezone);
    groups.set(date, [...(groups.get(date) ?? []), slot]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, times]) => ({ date, slots: times.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)) }));
}
export function dayLabel(date: string) { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`)); }
export function slotTimeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "longOffset" }).format(new Date(value)); }
export function hostTimeLabel(value: string, hostZone: string, inviteeZone: string, includeZone = true) {
  if (hostZone === inviteeZone) return undefined;
  const date = dateInZone(value, hostZone) !== dateInZone(value, inviteeZone) ? `${dayLabel(dateInZone(value, hostZone))}, ` : "";
  return `Host: ${date}${slotTimeLabel(value, hostZone)}${includeZone ? ` · ${hostZone}` : ""}`;
}
export function shiftHostDate(value: string, days: number) { const date = new Date(`${value}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
