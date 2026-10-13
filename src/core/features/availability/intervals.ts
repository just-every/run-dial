import type { BusyInterval } from "./engine";

/** The parts of `intervals` that none of `removed` covers. */
export function withoutIntervals(intervals: BusyInterval[], removed: BusyInterval[]): BusyInterval[] {
  let remaining = intervals.map((interval) => [Date.parse(interval.startAt), Date.parse(interval.endAt)] as const);
  for (const cut of removed) {
    const start = Date.parse(cut.startAt), end = Date.parse(cut.endAt);
    remaining = remaining.flatMap(([from, to]) => to <= start || from >= end
      ? [[from, to] as const]
      : [...(from < start ? [[from, start] as const] : []), ...(to > end ? [[end, to] as const] : [])]);
  }
  return remaining.map(([from, to]) => ({ startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString() }));
}
