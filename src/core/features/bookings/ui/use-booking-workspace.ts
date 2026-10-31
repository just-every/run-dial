import { useMemo } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { bookingWorkspaceSearch, readBookingFilters, readBookingPage, writeBookingFilters, type BookingFilters } from "./booking-filters";

/** The router location is the source of truth on reload, navigation and history. */
export function useBookingWorkspace() {
  const router = useRouter();
  const search = useRouterState({ select: (state) => bookingWorkspaceSearch(state.location.search, state.location.searchStr) });
  return useMemo(() => {
    const filters = readBookingFilters(search);
    const page = readBookingPage(search);
    const erasedId = new URLSearchParams(search).get("cleanup") ?? undefined;
    const requestedView = new URLSearchParams(search).get("view");
    const view = requestedView === "calendar" ? "calendar" as const : requestedView === "report" ? "report" as const : "list" as const;
    /** The list's address with these filters, or, given `record`, that booking's path with them (its index moves, the record stays). */
    const navigate = (nextFilters: BookingFilters, nextPage: number, replace = false, cleanup = erasedId, record?: string) => {
      const params = new URLSearchParams(writeBookingFilters(search, nextFilters, nextPage));
      if (cleanup) params.set("cleanup", cleanup);
      // A client's door names its client only while its booking is open.
      if (!record) params.delete("client");
      const next = () => Object.fromEntries(params);
      return record ? router.navigate({ to: "/app/bookings/$id", params: { id: record }, search: next, replace, resetScroll: false })
        : router.navigate({ to: "/app/bookings", search: next, replace, resetScroll: false });
    };
    return { filters, page, erasedId, view, navigate };
  }, [router, search]);
}
