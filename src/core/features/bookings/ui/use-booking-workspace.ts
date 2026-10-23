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
    const view = requestedView === "calendar" ? "calendar" as const : requestedView === "polls" ? "polls" as const : requestedView === "report" ? "report" as const : requestedView === "clients" ? "clients" as const : "list" as const;
    const navigate = (nextFilters: BookingFilters, nextPage: number, replace = false, cleanup = erasedId) => {
      const params = new URLSearchParams(writeBookingFilters(search, nextFilters, nextPage));
      if (cleanup) params.set("cleanup", cleanup);
      return router.navigate({ to: "/app/bookings", search: () => Object.fromEntries(params), replace, resetScroll: false });
    };
    return { filters, page, erasedId, view, navigate };
  }, [router, search]);
}
