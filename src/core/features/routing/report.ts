import { datePlus, hostDateForInstant } from "../availability";
import { hostDateFilterBounds } from "../bookings";
import { hostDateSchema } from "../../shared/scheduling";
import type { HostProfileService } from "../host-profile";

export type RoutingReportPeriod = { fromDate?: string; throughDate?: string; eventTypeId?: string };
export type RoutingSubmissionFilter = { from: string; to: string; eventTypeId?: string };

/** Cohort dates follow the host's civil calendar, including DST boundaries. */
export async function resolveRoutingPeriod(profiles: Pick<HostProfileService, "getProfile">, period: RoutingReportPeriod, now = new Date()) {
  const profile = await profiles.getProfile();
  if (!profile) return { kind: "host_profile_required" as const };
  const throughDate = period.throughDate ?? hostDateForInstant(now.toISOString(), profile.timezone);
  const validThrough = hostDateSchema.safeParse(throughDate);
  if (!validThrough.success) return { kind: "invalid_period" as const };
  const fromDate = period.fromDate ?? datePlus(throughDate, -29);
  if (!hostDateSchema.safeParse(fromDate).success || fromDate > throughDate) return { kind: "invalid_period" as const };
  if (datePlus(fromDate, 366) <= throughDate) return { kind: "period_too_long" as const };
  const { from, to } = hostDateFilterBounds(fromDate, throughDate, profile.timezone) as { from: string; to: string };
  return {
    kind: "resolved" as const,
    period: { fromDate, throughDate, timezone: profile.timezone, eventTypeId: period.eventTypeId ?? null },
    filter: { from, to, ...(period.eventTypeId ? { eventTypeId: period.eventTypeId } : {}) },
  };
}
