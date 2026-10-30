import type { z } from "zod";
import type { AppServices } from "../../app/services";
import { hostDateFilterBounds } from "./operator-date-filters";
import { operatorListSchema } from "./operator-query-schema";
export { instantSchema, operatorListSchema } from "./operator-query-schema";

/** Both the workspace and its CSV use the same validated filters and host-date boundaries. */
export async function resolveOperatorBookingQuery(services: AppServices, query: z.infer<typeof operatorListSchema>) {
  const { fromDate, throughDate, report, bucket, periodFrom, periodThrough, ...filters } = query;
  const profile = await services.hostProfile.getProfile();
  const drill = report ? await services.reports.members({ fromDate: periodFrom, throughDate: periodThrough, eventTypeId: filters.eventTypeId }, report, bucket) : undefined;
  if (drill && drill.kind !== "members") return drill;
  if ((fromDate || throughDate) && !profile) return { kind: "host_profile_required" as const };
  const bounds = profile ? hostDateFilterBounds(fromDate, throughDate, profile.timezone) : {};
  return { kind: "filters" as const, timezone: profile?.timezone, filters: { ...filters, ...bounds, ...(drill ? { ids: drill.ids } : {}) } };
}
