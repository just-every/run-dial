import { datePlus, hostDateForInstant } from "../availability";
import { hostDateFilterBounds } from "../bookings";
import type { HostProfileService } from "../host-profile";
import { reportTileKeys, type ReportTileKey, type SchedulingReport } from "./catalog";
import { ReportFactsRepository } from "./facts";
import { buildSchedulingReport } from "./scheduling-report";

export type ReportPeriod = { fromDate?: string; throughDate?: string; eventTypeId?: string };
export const maxReportDays = 366;

/** REPORT-001: scheduling analytics for the single host this install has. Teams and roles arrive with TEAM-001, TEAM-002 and OPER-001. */
export class ReportsService {
  constructor(private readonly facts: ReportFactsRepository, private readonly profiles: Pick<HostProfileService, "getProfile">) {}

  async report(period: ReportPeriod, now = new Date()) {
    const resolved = await this.resolve(period, now);
    if (resolved.kind !== "resolved") return resolved;
    const built = buildSchedulingReport(await this.facts.facts(resolved.bounds, period.eventTypeId), { timezone: resolved.timezone, ...resolved.bounds, now: now.toISOString() });
    const report: SchedulingReport = { period: { fromDate: resolved.fromDate, throughDate: resolved.throughDate, timezone: resolved.timezone }, eventTypeId: period.eventTypeId ?? null, tiles: built.tiles };
    return { kind: "report" as const, report };
  }

  /** The booking IDs one tile, or one bucket of it, counts: what a drill-through lists. */
  async members(period: ReportPeriod, tile: ReportTileKey, bucket: string | undefined, now = new Date()) {
    const resolved = await this.resolve(period, now);
    if (resolved.kind !== "resolved") return resolved;
    const built = buildSchedulingReport(await this.facts.facts(resolved.bounds, period.eventTypeId), { timezone: resolved.timezone, ...resolved.bounds, now: now.toISOString() });
    return { kind: "members" as const, ids: built.members.get(bucket ? `${tile}|${bucket}` : tile) ?? [] };
  }

  private async resolve(period: ReportPeriod, now: Date) {
    const profile = await this.profiles.getProfile();
    if (!profile) return { kind: "host_profile_required" as const };
    const throughDate = period.throughDate ?? hostDateForInstant(now.toISOString(), profile.timezone);
    const fromDate = period.fromDate ?? datePlus(throughDate, -29);
    if (fromDate > throughDate) return { kind: "invalid_period" as const };
    if (datePlus(fromDate, maxReportDays) <= throughDate) return { kind: "period_too_long" as const };
    const { from, to } = hostDateFilterBounds(fromDate, throughDate, profile.timezone) as { from: string; to: string };
    return { kind: "resolved" as const, fromDate, throughDate, timezone: profile.timezone, bounds: { from, to } };
  }
}

export { reportTileKeys };
