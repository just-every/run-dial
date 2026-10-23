import { ApprovalRequests } from "./approval-requests";
import { ErasureRecovery } from "./delivery-actions";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Card, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import { BookingDetail, BookingBadge } from "./booking-detail";
import { bookingPageSize, hasBookingFilters, type BookingFilters } from "./booking-filters";
import { BookingsFilterBar } from "./bookings-filter-bar";

import { useBookingWorkspace } from "./use-booking-workspace";
import { useBookingList } from "./use-booking-list";
import { useEventTypes } from "./use-event-types";
import { SchedulingReportView } from "./scheduling-report";
import { ReportDrillNotice } from "./report-drill-notice";
import { startTime } from "./operator-time";
import { ClientsWorkspace } from "../../clients/client";

/** The bookings list, or the scheduling report (REPORT-001) that drills into it. */
export function BookingsPage(): React.JSX.Element {
  const { view } = useBookingWorkspace();
  return view === "clients" ? <ClientsWorkspace /> : view === "report" ? <ReportWorkspace /> : <BookingList />;
}

function ReportWorkspace(): React.JSX.Element {
  const { filters, navigate } = useBookingWorkspace();
  const { eventTypes } = useEventTypes();
  return <SchedulingReportView filters={filters} eventTypes={eventTypes} onChange={change => void navigate({ ...filters, ...change }, 1, true)} />;
}

function BookingList(): React.JSX.Element {
  const { eventTypes, error: eventTypesError } = useEventTypes();
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState("");
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  const { filters, page, erasedId, navigate } = useBookingWorkspace();
  const moveToPage = useCallback((nextPage: number) => navigate(filters, nextPage, true), [filters, navigate]);
  const { bookings, totalCount, hostTimezone, loading, listError, load } = useBookingList(filters, page, moveToPage);
  useEffect(() => {
    if (!loading && notice && focusNotice.current) { noticeElement.current?.focus(); focusNotice.current = false; }
  }, [loading, notice]);

  function changeFilters(change: Partial<BookingFilters>) {
    const next = { ...filters, ...change };
    if (next.from && next.to && next.from > next.to) {
      if (change.from) next.to = change.from;
      else if (change.to) next.from = change.to;
    }
    void navigate(next, 1, Object.hasOwn(change, "query"));
  }

  function clearFilters() { void navigate({}, 1); }

  async function cancel(id: string) {
    const reason = window.prompt("Reason for cancellation (optional)");
    if (reason === null) return;
    const response = await api.api.app.bookings[":id"].cancel.$post({ param: { id }, json: reason ? { reason } : {} });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    focusNotice.current = true; setNotice("Booking cancelled and delivery updates queued."); await load();
  }

  async function attendance(id: string, status: "attended" | "no_show") {
    const note = window.prompt(status === "attended" ? "Attendance note" : "No-show note");
    if (note === null) return;
    const response = await api.api.app.bookings[":id"].attendance.$post({ param: { id }, json: { status, note } });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    focusNotice.current = true; setNotice("Attendance recorded."); await load();
  }

  const active = bookings?.find((booking) => booking.id === selected) ?? bookings?.[0];
  const filtered = hasBookingFilters(filters);
  const pageCount = Math.max(1, Math.ceil(totalCount / bookingPageSize));
  const firstVisible = totalCount === 0 ? 0 : (page - 1) * bookingPageSize + 1;
  const lastVisible = Math.min(page * bookingPageSize, totalCount);

  return <div className="grid gap-7">
    <PageHeader eyebrow="Booking workspace" title="Bookings" description="Review bookings, delivery state, and attendance." actions={<><Link to="/app/bookings" search={() => ({ view: "clients" })} className={buttonClassName("secondary")}>Clients</Link><Link to="/app/bookings" search={() => ({ view: "report" })} className={buttonClassName("secondary")}>Scheduling report</Link><Link to="/app/bookings/new" className={buttonClassName()}>Create booking</Link></>} />
    {notice ? <p ref={noticeElement} tabIndex={-1} role="status" aria-label="Booking update" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}
    {listError ? <p role="alert" className={noticeClassName("error", "font-semibold")}>{listError}</p> : null}
    {eventTypesError ? <p role="alert" className={noticeClassName("error", "font-semibold")}>{eventTypesError}</p> : null}
    {erasedId ? <ErasureRecovery bookingId={erasedId} /> : null}
    {filters.report ? <ReportDrillNotice filters={filters} /> : null}
    <ApprovalRequests onChanged={load} />
    <BookingsFilterBar filters={filters} eventTypes={eventTypes} hostTimezone={hostTimezone} onChange={changeFilters} onClear={clearFilters} />
    <p className="text-sm font-semibold text-soft" role="status" aria-live="polite">
      {loading ? "Loading bookings…" : bookings === undefined ? "Bookings unavailable" : `Showing ${firstVisible.toLocaleString()}–${lastVisible.toLocaleString()} of ${totalCount.toLocaleString()} matching booking${totalCount === 1 ? "" : "s"}`}
    </p>
    {!loading && bookings && pageCount > 1 ? <nav className="flex flex-wrap items-center gap-3" aria-label="Booking result pages">
      <button type="button" className={buttonClassName("secondary")} onClick={() => void navigate(filters, Math.max(1, page - 1))} disabled={page <= 1}>Previous page</button>
      <span className="text-sm text-muted">Page {page.toLocaleString()} of {pageCount.toLocaleString()}</span>
      <button type="button" className={buttonClassName("secondary")} onClick={() => void navigate(filters, Math.min(pageCount, page + 1))} disabled={page >= pageCount}>Next page</button>
    </nav> : null}
    {loading || bookings === undefined ? null : bookings.length === 0
      ? filtered
        ? <EmptyState title="No bookings match these filters" description="Change a filter or clear them to see more bookings." action={<button type="button" className={buttonClassName()} onClick={clearFilters}>Clear filters</button>} />
        : <EmptyState title="No bookings yet" description="Create an operator booking or turn an agreed alternative request into one." action={<Link to="/app/requests" className={buttonClassName()}>Open requests</Link>} />
      : <div className="grid items-start gap-5 xl:grid-cols-[minmax(260px,.8fr)_minmax(0,1.4fr)]">
        <Card className="divide-y divide-line-soft overflow-hidden">
          {bookings.map((booking) => <button type="button" className={`w-full px-5 py-4 text-left transition-colors ${active?.id === booking.id ? "bg-gold-wash" : "hover:bg-row"}`} onClick={() => setSelected(booking.id)} key={booking.id}>
            <div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block text-base font-bold leading-[1.3]">{booking.inviteeName}</strong>{booking.imported ? <small className="text-sm text-muted">Imported · </small> : null}<small className="text-sm text-muted">{booking.eventTitle}</small></span><BookingBadge state={booking.state} /></div>
            <p className="mt-2 text-[15px] text-soft">{startTime(booking.occurrence.startAt, booking.hostTimezone)}</p>
          </button>)}
        </Card>
        {active ? <BookingDetail key={active.id} booking={active} onChanged={async (message) => { setNotice(message ?? ""); await load(); }} onCancel={cancel} onAttendance={attendance} onErased={(message, id) => { setNotice(message); void navigate(filters, page, true, id).then(() => load()); }} /> : null}
      </div>}
  </div>;
}
