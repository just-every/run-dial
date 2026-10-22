import type { BookingRecord } from "../types";
import { reportTileKeys, type ReportTileKey } from "../../reports/client";

export type BookingFilters = {
  state?: BookingRecord["state"];
  time?: "future" | "past";
  eventTypeId?: string;
  from?: string;
  to?: string;
  deliveryFailed?: "true" | "false";
  rescheduleRequest?: "open" | "picked" | "expired" | "cancelled";
  query?: string;
  /** A drill-through from the scheduling report: the tile, its bucket and the report's period (REPORT-001). */
  report?: ReportTileKey;
  bucket?: string;
  periodFrom?: string;
  periodThrough?: string;
};

const filterKeys = ["state", "time", "eventTypeId", "from", "to", "deliveryFailed", "rescheduleRequest", "query", "report", "bucket", "periodFrom", "periodThrough"] as const;
const bookingStates = ["confirmed", "rescheduled", "cancelled"] as const;
export const bookingPageSize = 100;

/** Keep literal URL values when the router decodes JSON-shaped query text. */
export function bookingWorkspaceSearch(parsed: Record<string, unknown>, raw: string) {
  const params = new URLSearchParams(raw);
  for (const [key, value] of Object.entries(parsed)) {
    // Router navigation quotes strings that resemble JSON. Its parsed string
    // is authoritative; other JSON types retain their original URL spelling.
    if (typeof value === "string") params.set(key, value);
  }
  return params.toString();
}

export function readBookingPage(search: string) {
  const value = Number(new URLSearchParams(search).get("page"));
  return Number.isSafeInteger(value) && value > 0 && value <= 10_001 ? value : 1;
}

export function readBookingFilters(search: string): BookingFilters {
  const params = new URLSearchParams(search);
  const state = params.get("state");
  const time = params.get("time");
  const eventTypeId = params.get("eventTypeId");
  const from = dateValue(params.get("from"));
  const to = dateValue(params.get("to"));
  const deliveryFailed = params.get("deliveryFailed");
  const rescheduleRequest = params.get("rescheduleRequest");
  const query = params.get("query")?.slice(0, 160) || undefined;
  const report = reportTileKeys.find(key => key === params.get("report"));
  const periodFrom = dateValue(params.get("periodFrom")), periodThrough = dateValue(params.get("periodThrough"));
  const bucket = params.get("bucket")?.slice(0, 200) || undefined;

  return {
    ...(report && periodFrom && periodThrough ? { report, periodFrom, periodThrough, ...(bucket ? { bucket } : {}) } : {}),
    ...(bookingStates.includes(state as BookingRecord["state"]) ? { state: state as BookingRecord["state"] } : {}),
    ...(time === "future" || time === "past" ? { time } : {}),
    ...(eventTypeId && eventTypeId.length === 26 ? { eventTypeId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(deliveryFailed === "true" || deliveryFailed === "false" ? { deliveryFailed } : {}),
    ...(rescheduleRequest === "open" || rescheduleRequest === "picked" || rescheduleRequest === "expired" || rescheduleRequest === "cancelled" ? { rescheduleRequest } : {}),
    ...(query ? { query } : {}),
  };
}

export function bookingListQuery(filters: BookingFilters, page = 1) {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.time ? { time: filters.time } : {}),
    ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}),
    ...(filters.from ? { fromDate: filters.from } : {}),
    ...(filters.to ? { throughDate: filters.to } : {}),
    ...(filters.deliveryFailed ? { deliveryFailed: filters.deliveryFailed } : {}),
    ...(filters.rescheduleRequest ? { rescheduleRequest: filters.rescheduleRequest } : {}),
    ...(filters.query?.trim() ? { query: filters.query.trim().slice(0, 160) } : {}),
    ...(filters.report && filters.periodFrom && filters.periodThrough ? { report: filters.report, periodFrom: filters.periodFrom, periodThrough: filters.periodThrough, ...(filters.bucket ? { bucket: filters.bucket } : {}) } : {}),
    limit: String(bookingPageSize),
    offset: String((Math.max(1, page) - 1) * bookingPageSize),
  };
}

export function hasBookingFilters(filters: BookingFilters) {
  return filterKeys.some((key) => {
    const value = filters[key];
    return key === "query" ? Boolean(value?.trim()) : Boolean(value);
  });
}

export function writeBookingFilters(search: string, filters: BookingFilters, page = 1) {
  const params = new URLSearchParams(search);
  for (const key of filterKeys) params.delete(key);
  params.delete("page");
  for (const key of filterKeys) {
    const value = filters[key];
    if (key === "query" && typeof value === "string") {
      if (value.trim()) params.set(key, value.slice(0, 160));
    } else if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

function dateValue(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}
