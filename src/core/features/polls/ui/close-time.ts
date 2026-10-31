import { wallClockInstants, zonedParts } from "../../availability/client";

const hour = 3_600_000, pad = (value: number) => String(value).padStart(2, "0");

/** A datetime-local value, read as a wall clock in the page's zone, as an instant; undefined when that clock time does not exist there. */
export function closeInstant(value: string, zone: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return match ? wallClockInstants(match[1], Number(match[2]) * 60 + Number(match[3]), zone)[0]?.toISOString() : undefined;
}

/** The close time offered until the owner sets one: three days from now, but a day before the earliest candidate (an hour before when that is sooner), on the hour in the page's zone. */
export function defaultClose(zone: string, starts: string[], now = Date.now()) {
  const earliest = starts.length ? Math.min(...starts.map(start => Date.parse(start))) : undefined;
  let at = now + 72 * hour;
  if (earliest !== undefined) at = Math.min(at, earliest - 24 * hour);
  if (earliest !== undefined && at < now + hour) at = earliest - hour;
  const parts = zonedParts(new Date(at), zone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:00`;
}
