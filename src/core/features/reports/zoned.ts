import { zonedParts } from "../availability";

/** The weekday (0 Sunday to 6 Saturday) and hour of an instant on the host's wall clock, across DST changes. */
export function hostWeekdayAndHour(instant: string, timeZone: string) {
  const parts = zonedParts(new Date(instant), timeZone);
  return { weekday: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(), hour: parts.hour % 24 };
}
