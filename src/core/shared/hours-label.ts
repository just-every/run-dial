export type HoursWindow = { weekday: number; startMinute: number; endMinute: number };
/** Monday first, as the weekly hours list them: weekday number, name, short name. */
export const weekdays = [[1, "Monday", "Mon"], [2, "Tuesday", "Tue"], [3, "Wednesday", "Wed"], [4, "Thursday", "Thu"], [5, "Friday", "Fri"], [6, "Saturday", "Sat"], [0, "Sunday", "Sun"]] as const;

export function clockLabel(minutes: number) {
  const value = minutes === 1440 ? 0 : minutes;
  const hour = Math.floor(value / 60), minute = value % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
}

/** One line for a set of weekly hours, in the one style every screen uses: "Mon, Tue 9 AM–5 PM · Fri 1 PM–4 PM". */
export function hoursSummary(windows: HoursWindow[]) {
  if (!windows.length) return "No hours yet";
  const grouped = new Map<string, string[]>();
  for (const [weekday, , short] of weekdays) {
    const ranges = windows.filter(window => window.weekday === weekday).map(window => `${clockLabel(window.startMinute)}–${clockLabel(window.endMinute)}`).join(", ");
    if (ranges) grouped.set(ranges, [...(grouped.get(ranges) ?? []), short]);
  }
  return [...grouped].map(([ranges, days]) => `${days.join(", ")} ${ranges}`).join(" · ");
}
