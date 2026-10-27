import type { HoursRead } from "../../availability";
import type { AvailabilityWindowInput, EventTypeRecord } from "../repository";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function time(minute: number) { const hour = Math.floor(minute / 60); return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`; }
export function windowsSummary(windows: AvailabilityWindowInput[]) {
  if (!windows.length) return "No hours set";
  const groups = new Map<string, { days: number[]; start: number; end: number }>();
  for (const window of windows) {
    const key = `${window.startMinute}-${window.endMinute}`;
    const group = groups.get(key) ?? { days: [], start: window.startMinute, end: window.endMinute };
    if (!group.days.includes(window.weekday)) group.days.push(window.weekday);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const sorted = group.days.sort((a, b) => (a || 7) - (b || 7));
    const contiguous = sorted.length > 2 && sorted.every((day, index) => !index || (day || 7) === (sorted[index - 1] || 7) + 1);
    const label = contiguous ? `${days[sorted[0]]}–${days[sorted.at(-1)!]}` : sorted.map(day => days[day]).join(", ");
    return `${label} ${time(group.start)} – ${time(group.end)}`;
  }).join(" · ");
}
export function hoursSummary(event: EventTypeRecord, hours?: HoursRead) {
  if (!hours) return "Hours could not be loaded";
  const uses = hours.events.find(item => item.id === event.id)?.uses;
  if (uses === "yours") return `Your hours · ${windowsSummary(hours.yours?.windows ?? [])}`;
  if (uses && uses !== "own") return hours.others.find(item => item.id === uses)?.name ?? "Hours unavailable";
  return `Its own hours · ${windowsSummary(event.availability)}`;
}
