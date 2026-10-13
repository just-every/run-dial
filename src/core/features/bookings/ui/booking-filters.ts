import type { BookingRecord } from "../types";

export type BookingFilters = {
  state?: BookingRecord["state"];
  time?: "future" | "past";
  eventTypeId?: string;
  from?: string;
  to?: string;
  deliveryFailed?: "true" | "false";
  query?: string;
};

const filterKeys = ["state", "time", "eventTypeId", "from", "to", "deliveryFailed", "query"] as const;
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
  const query = params.get("query")?.slice(0, 160) || undefined;

  return {
    ...(bookingStates.includes(state as BookingRecord["state"]) ? { state: state as BookingRecord["state"] } : {}),
    ...(time === "future" || time === "past" ? { time } : {}),
    ...(eventTypeId && eventTypeId.length === 26 ? { eventTypeId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(deliveryFailed === "true" || deliveryFailed === "false" ? { deliveryFailed } : {}),
    ...(query ? { query } : {}),
  };
}

export function bookingListQuery(filters: BookingFilters, page = 1) {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.time ? { time: filters.time } : {}),
    ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}),
    ...(filters.from ? { from: `${filters.from}T00:00:00.000Z` } : {}),
    ...(filters.to ? { to: `${filters.to}T23:59:59.999Z` } : {}),
    ...(filters.deliveryFailed ? { deliveryFailed: filters.deliveryFailed } : {}),
    ...(filters.query?.trim() ? { query: filters.query.trim().slice(0, 160) } : {}),
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
