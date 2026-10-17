import { wallClockInstants } from "../../availability";
import { formatZonedTime } from "../../../shared/timezone-lock";

export function LockedRequestWindow({ date, startMinute, endMinute, timezone, browserTimezone }: { date: string; startMinute: number; endMinute: number; timezone: string; browserTimezone: string | null }) {
  const start = wallClockInstants(date, startMinute, timezone)[0];
  const end = wallClockInstants(date, endMinute, timezone).at(-1);
  if (!start || !end) throw new RangeError("The requested window does not exist in its timezone.");
  return <>{formatZonedTime(start, timezone)} – {formatZonedTime(end, timezone)}{browserTimezone && browserTimezone !== timezone ? <><br />Your browser time: {formatZonedTime(start, browserTimezone)} – {formatZonedTime(end, browserTimezone)}</> : null}</>;
}
