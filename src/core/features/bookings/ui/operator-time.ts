import { operatorDateTime, operatorTimeRange } from "../../../shared/operator-format";
import { wallClockInstants, zonedParts, zonedOffsetLabel } from "../../availability";

export function localInput(instant: string, timezone: string) {
  const parts = zonedParts(new Date(instant), timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Every UTC candidate round-trips to the named wall clock; folds need an explicit choice. */
export function resolveOperatorTime(local: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const [date, time] = local.split("T");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return [];
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return [];
  try { return wallClockInstants(date, hour * 60 + minute, timezone).map((instant) => ({ instant: instant.toISOString(), label: zonedOffsetLabel(instant, timezone) })); }
  catch { return []; }
}

export function timeRange(start: string | null, end: string | null, timezone: string) {
  return operatorTimeRange(start, end, timezone);
}

export function startTime(start: string, timezone: string) {
  return operatorDateTime(start, timezone);
}
