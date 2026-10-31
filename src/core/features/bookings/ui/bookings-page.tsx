import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { RecordNotFound } from "./record-not-found";
import { CalendarWorkspace } from "./calendar-workspace";
import { ApprovalRequests } from "./approval-requests";
import { ErasureRecovery } from "./delivery-actions";
import { Link, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Badge, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import { IndexHead, PageOnly, RecordBack, RecordLayout, RecordRow, RecordRows, countOf, recordTrail, useReturnFocus } from "../../../app/ui/record-layout";
import { useRecordRead } from "../../../app/use-record-read";
import { BookingBadge } from "./booking-detail";
import { BookingRecordPage, useBookingRead, type BookingRead } from "./booking-record";
import { bookingPageSize, hasBookingFilters, writeBookingFilters, type BookingFilters } from "./booking-filters";
import { BookingsFilterBar } from "./bookings-filter-bar";
import { clientAddress, clientNamePath, type ClientHistory } from "../../clients/client";

import { useBookingWorkspace } from "./use-booking-workspace";
import { useBookingList } from "./use-booking-list";
import { useEventTypes } from "./use-event-types";
import { SchedulingReportView } from "./scheduling-report";
import { ReportDrillNotice } from "./report-drill-notice";
import { timeRange } from "./operator-time";

/** The bookings list, its calendar or the scheduling report (REPORT-001), and a booking at its own path /app/bookings/<id>. */
export function BookingsPage(): React.JSX.Element {
  const { view } = useBookingWorkspace();
  const selected = useRouterState({ select: state => (state.matches.at(-1)?.params as { id?: string } | undefined)?.id });
  const booking = useBookingRead(selected);
  if (booking.missing) return <RecordNotFound kind="booking" back="/app/bookings" />;
  if (view === "calendar") return <CalendarWorkspace booking={booking} />;
  return view === "report" && !selected ? <ReportWorkspace /> : <BookingList booking={booking} />;
}

function ReportWorkspace(): React.JSX.Element {
  const { filters, navigate } = useBookingWorkspace();
  const { eventTypes } = useEventTypes();
  return <SchedulingReportView filters={filters} eventTypes={eventTypes} onChange={change => void navigate({ ...filters, ...change }, 1, true)} />;
}

/** The full Bookings page, or, beside an open booking, its index: the rows its search string selects, without the filter card. */
function BookingList({ booking }: { booking: BookingRead }): React.JSX.Element {
  const { eventTypes, error: eventTypesError } = useEventTypes();
  const searchStr = useRouterState({ select: state => state.location.searchStr });
  const [notice, setNotice] = useState("");
  const { filters, page, erasedId, navigate } = useBookingWorkspace();
  const open = Boolean(booking.id);
  // Opening another booking must not reload the index, so a page past the end reads the open record from a ref.
  const openRecord = useRef(booking.id);
  useEffect(() => { openRecord.current = booking.id; }, [booking.id]);
  const moveToPage = useCallback((nextPage: number) => navigate(filters, nextPage, true, undefined, openRecord.current), [filters, navigate]);
  const { bookings, totalCount, hostTimezone, loading, listError, load } = useBookingList(filters, page, moveToPage);
  // A client's "Open booking record" carries the client: its index is that client's bookings, under the client's name.
  const client = clientAddress(new URLSearchParams(searchStr).get("client") ?? undefined);
  const clientName = useRecordRead<ClientHistory>(open && client ? clientNamePath(client) : undefined).data?.name;
  const list = client ? `/app/clients/${encodeURIComponent(client)}` : `/app/bookings${searchStr}`;
  const back = (className?: string) => <RecordBack href={list} label={client ? clientName || client : "Bookings"} className={className} />;
  // Back from a client's booking lands on the client's page, which returns focus itself.
  useReturnFocus(client ? undefined : list, open);

  function changeFilters(change: Partial<BookingFilters>) {
    const next = { ...filters, ...change };
    if (next.from && next.to && next.from > next.to) {
      if (change.from) next.to = change.from;
      else if (change.to) next.from = change.to;
    }
    void navigate(next, 1, Object.hasOwn(change, "query"));
  }

  function clearFilters() { void navigate({}, 1); }

  const filtered = hasBookingFilters(filters);
  const pageCount = Math.max(1, Math.ceil(totalCount / bookingPageSize));
  const firstVisible = totalCount === 0 ? 0 : (page - 1) * bookingPageSize + 1;
  const lastVisible = Math.min(page * bookingPageSize, totalCount);
  const record = open ? <BookingRecordPage key={booking.id} read={booking} back={back("xl:hidden")} onIndexChanged={() => void load(false)}
    onErased={(message, id) => { setNotice(message); void navigate(filters, page, true, id).then(() => load()); }} /> : undefined;

  return <RecordLayout record={record}>
    <div className="grid gap-7">
      <PageOnly>
        <PageHeader title="Bookings" description="Review bookings, delivery state, and attendance." actions={<><Link to="/app/bookings" search={() => ({ ...Object.fromEntries(new URLSearchParams(writeBookingFilters("", filters))), view: "calendar" })} className={buttonClassName("secondary")}>Calendar</Link><Link to="/app/polls" className={buttonClassName("secondary")}>Meeting polls</Link><Link to="/app/clients" className={buttonClassName("secondary")}>Clients</Link><Link to="/app/bookings" search={() => ({ view: "report" })} className={buttonClassName("secondary")}>Scheduling report</Link><Link to="/app/bookings/new" className={buttonClassName()}>Create booking</Link></>} />
        {hostTimezone && !open ? <p className="text-sm text-muted">Times in {hostTimezone}</p> : null}
        {notice ? <p role="status" aria-label="Booking update" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}
        {listError ? <WorkspaceLoadState error={listError} onRetry={() => load()} /> : null}
        {eventTypesError ? <p role="alert" className={noticeClassName("error", "font-semibold")}>{eventTypesError}</p> : null}
        {erasedId ? <ErasureRecovery bookingId={erasedId} /> : null}
        {filters.report ? <ReportDrillNotice filters={filters} /> : null}
        <ApprovalRequests onChanged={load} />
        <BookingsFilterBar filters={filters} eventTypes={eventTypes} hostTimezone={hostTimezone} onChange={changeFilters} onClear={clearFilters} />
        <p className="text-sm font-semibold text-soft" role="status" aria-live="polite">
          {loading ? null : bookings === undefined ? null : `Showing ${firstVisible.toLocaleString()}–${lastVisible.toLocaleString()} of ${totalCount.toLocaleString()} matching booking${totalCount === 1 ? "" : "s"}`}
        </p>
        {loading && !listError ? <WorkspaceLoadState label="Loading bookings…" onRetry={() => load()} /> : null}
        {!loading && bookings && pageCount > 1 ? <nav className="flex flex-wrap items-center gap-3" aria-label="Booking result pages">
          <button type="button" className={buttonClassName("secondary")} onClick={() => void navigate(filters, Math.max(1, page - 1))} disabled={page <= 1}>Previous page</button>
          <span className="text-sm text-muted">Page {page.toLocaleString()} of {pageCount.toLocaleString()}</span>
          <button type="button" className={buttonClassName("secondary")} onClick={() => void navigate(filters, Math.min(pageCount, page + 1))} disabled={page >= pageCount}>Next page</button>
        </nav> : null}
      </PageOnly>
      <IndexHead back={back()} meta={bookings ? countOf(totalCount, "booking") : undefined} />
      {loading || bookings === undefined ? null : bookings.length ? <RecordRows>
        {bookings.map(row => <RecordRow key={row.id} to="/app/bookings/$id" params={{ id: row.id }} search={previous => previous} state={recordTrail(list)} row={row.id} list={list} current={row.id === booking.id}>
          <div className="flex items-start justify-between gap-3"><strong className="min-w-0 text-base font-bold leading-[1.3]">{row.inviteeName}</strong>{row.state === "confirmed" && row.attendance?.status === "no_show" ? <Badge>No-show</Badge> : <BookingBadge state={row.state} />}</div>
          <p className="mt-1 truncate text-sm text-muted">{timeRange(row.occurrence.startAt, row.occurrence.endAt, row.hostTimezone)} · {row.eventTitle}{row.imported ? " · Imported" : ""}</p>
        </RecordRow>)}
      </RecordRows> : open ? null : filtered
        ? <EmptyState title="No bookings match these filters" description="Change a filter or clear them to see more bookings." action={<button type="button" className={buttonClassName()} onClick={clearFilters}>Clear filters</button>} />
        : <EmptyState title="No bookings yet" description="Create an operator booking or turn an agreed alternative request into one." action={<Link to="/app/requests" className={buttonClassName()}>Open requests</Link>} />}
    </div>
  </RecordLayout>;
}
