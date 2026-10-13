import { datePlus, firstInstantOfHostDate, hostDateAt, wallClockInstants, zonedParts } from "./timezone";

/** Exclusive final boundary, after a repeated midnight or a skipped civil date. */
export function endOfHostDate(hostDate: string, timeZone: string) {
  for (let day = 1; day <= 3; day++) {
    const first = firstInstantOfHostDate(datePlus(hostDate, day), timeZone);
    if (!first) continue;
    const parts = zonedParts(first, timeZone);
    return wallClockInstants(hostDateAt(first, timeZone), parts.hour * 60 + parts.minute, timeZone).at(-1);
  }
  return undefined;
}
