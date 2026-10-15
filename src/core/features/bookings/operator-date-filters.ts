import { firstInstantOfHostDate } from "../availability";
import { datePlus } from "../availability/timezone";

/** Civil dates may have a midnight gap, a repeated midnight, or be skipped entirely. */
function dateBoundary(date: string, timezone: string): Date {
  for (let offset = 0; offset <= 3; offset++) {
    const boundary = firstInstantOfHostDate(datePlus(date, offset), timezone);
    if (boundary) return boundary;
  }
  throw new Error(`No civil date boundary could be resolved in ${timezone}.`);
}

export function hostDateFilterBounds(fromDate: string | undefined, throughDate: string | undefined, timezone: string) {
  return {
    ...(fromDate ? { from: dateBoundary(fromDate, timezone).toISOString() } : {}),
    ...(throughDate ? { to: new Date(dateBoundary(datePlus(throughDate, 1), timezone).getTime() - 1).toISOString() } : {}),
  };
}
