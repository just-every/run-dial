import type { ReportFigure } from "../../reports/client";
import { formatUsd } from "../../../shared/event-price";

/** The label a figure shows: whole bookings, one-decimal percentages and hours, dollars. */
export function formatFigure(figure: ReportFigure) {
  if (figure.value === null) return "No data";
  if (figure.unit === "percent") return `${figure.value}%`;
  if (figure.unit === "hours") return `${figure.value} hours`;
  if (figure.unit === "usd_cents") return formatUsd(figure.value);
  return figure.value.toLocaleString();
}

/** The bookings list that shows exactly what a tile, or one of its rows, counts. */
export function drillSearch(input: { tile: string; bucket?: string; fromDate: string; throughDate: string; eventTypeId: string | null }) {
  return { report: input.tile, periodFrom: input.fromDate, periodThrough: input.throughDate, ...(input.eventTypeId ? { eventTypeId: input.eventTypeId } : {}), ...(input.bucket ? { bucket: input.bucket } : {}) };
}
