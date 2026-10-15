import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import type { BookingRecord } from "../types";
import { bookingListQuery, bookingPageSize, type BookingFilters } from "./booking-filters";

export function useBookingList(filters: BookingFilters, page: number, moveToPage: (page: number) => Promise<void>) {
  const [bookings, setBookings] = useState<BookingRecord[]>();
  const [totalCount, setTotalCount] = useState(0);
  const [hostTimezone, setHostTimezone] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const latestRequest = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      const response = await api.api.app.bookings.$get({ query: bookingListQuery(filters, page) });
      if (response.ok) {
        const records = await response.json() as BookingRecord[];
        if (requestId !== latestRequest.current) return;
        const total = Number(response.headers.get("X-Total-Count") ?? 0);
        const lastPage = Math.max(1, Math.ceil(total / bookingPageSize));
        if (page > lastPage) {
          // Invalidate this response before navigating. The new location reloads
          // the actual page without briefly presenting a false empty result.
          latestRequest.current += 1;
          await moveToPage(lastPage);
          return;
        }
        setHostTimezone(response.headers.get("X-Host-Timezone") ?? undefined);
        setBookings(records);
        setTotalCount(total);
        setListError("");
      } else {
        const message = await errorMessage(response);
        if (requestId !== latestRequest.current) return;
        setBookings(undefined);
        setTotalCount(0);
        setListError(message);
      }
    } catch {
      if (requestId === latestRequest.current) {
        setBookings(undefined);
        setTotalCount(0);
        setListError("Bookings could not be loaded.");
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [filters, page, moveToPage]);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => { void load(); }, filters.query?.trim() ? 180 : 0);
    return () => { window.clearTimeout(timer); latestRequest.current += 1; };
  }, [filters, load]);
  return { bookings, totalCount, hostTimezone, loading, listError, load };
}
