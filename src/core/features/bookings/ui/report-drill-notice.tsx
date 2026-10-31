import { Link } from "@tanstack/react-router";
import { Card, buttonClassName } from "../../../app/ui/primitives";
import { operatorDay } from "../../../shared/operator-format";
import { bucketLabel, reportTileTitles } from "../../reports/client";
import type { BookingFilters } from "./booking-filters";

/** A list opened from a report tile names the figure it lists and the period it counts, and goes back to the report. */
export function ReportDrillNotice({ filters }: { filters: BookingFilters }) {
  if (!filters.report) return null;
  const back = { view: "report", from: filters.periodFrom ?? "", to: filters.periodThrough ?? "", ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}) };
  return <Card className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3">
    <p className="text-sm font-semibold text-ink" role="status">Counted by “{reportTileTitles[filters.report]}”{filters.bucket && bucketLabel(filters.bucket) ? ` · ${bucketLabel(filters.bucket)}` : ""}, {filters.periodFrom ? operatorDay(filters.periodFrom) : ""} to {filters.periodThrough ? operatorDay(filters.periodThrough) : ""}.</p>
    <Link to="/app/bookings" search={() => back} className={buttonClassName("secondary")}>Back to the report</Link>
  </div></Card>;
}
