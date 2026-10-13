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
    const navigate = (nextFilters: BookingFilters, nextPage: number, replace = false, cleanup = erasedId) => {
      const params = new URLSearchParams(writeBookingFilters(search, nextFilters, nextPage));
      if (cleanup) params.set("cleanup", cleanup);
      return router.navigate({ to: "/app/bookings", search: () => Object.fromEntries(params), replace, resetScroll: false });
    };
    return { filters, page, erasedId, navigate };
  }, [router, search]);
}
