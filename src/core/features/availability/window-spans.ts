import { firstInstantOfHostDate, zonedParts } from "./timezone";
import { endOfHostDate } from "./date-bounds";

type Window = { startMinute: number; endMinute: number };
export type WindowSpan = { start: number; end: number };
type WindowTimeline = { spans: WindowSpan[]; starts: number[] };

/** Each original window retains its own contiguous UTC spans, including folds. */
export function windowSpans(hostDate: string, timeZone: string, windows: Window[], startIncrementMinutes?: number) {
  const [year, month, day] = hostDate.split("-").map(Number);
  const result = new Map<Window, WindowTimeline>(windows.map((window) => [window, { spans: [], starts: [] }]));
  if (!windows.length) return result;
  const first = firstInstantOfHostDate(hostDate, timeZone);
  if (!first) return result;
  const next = endOfHostDate(hostDate, timeZone);
  if (!next) return result;
  for (let instant = first.getTime(); instant < next.getTime(); instant += 60_000) {
    const parts = zonedParts(new Date(instant), timeZone);
    if (parts.year !== year || parts.month !== month || parts.day !== day) continue;
    const minute = parts.hour * 60 + parts.minute;
    for (const window of windows) {
      if (minute < window.startMinute || minute >= window.endMinute) continue;
      const timeline = result.get(window)!;
      if (parts.second === 0 && startIncrementMinutes && (minute - window.startMinute) % startIncrementMinutes === 0) timeline.starts.push(instant);
      const spans = timeline.spans;
      const previous = spans.at(-1);
      if (previous?.end === instant) previous.end = instant + 60_000;
      else spans.push({ start: instant, end: instant + 60_000 });
    }
  }
  return result;
}

export function fitsWindow(spans: WindowSpan[], start: Date, end: Date) {
  return end.getTime() > start.getTime() && spans.some((span) => start.getTime() >= span.start && end.getTime() <= span.end);
}
