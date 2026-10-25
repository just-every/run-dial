import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useWorkspaceRead, useWorkspaceHeader } from "../../../app/workspace-reads";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../../api/client";
import { SectionHeading } from "../../../app/ui/page-header";
import { Badge, Card, textLinkClassName } from "../../../app/ui/primitives";
import type { IconName } from "../../../shared/drawing/icons";
import type { OperatorRequest } from "../../availability-requests";
import type { BookingRecord } from "../../bookings";

type ActivityState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; total: number; items: T[] };

export function OverviewActivity() {
  const initialBookings = useWorkspaceRead<BookingRecord[]>("/api/app/bookings?order=created&limit=3");
  const initialCount = useWorkspaceHeader("/api/app/bookings?order=created&limit=3", "x-total-count");
  const initialRequests = useWorkspaceRead<OperatorRequest[]>("/api/app/availability-requests");
  const [bookings, setBookings] = useState<ActivityState<BookingRecord>>(initialBookings ? { status: "loaded", total: Number(initialCount ?? 0), items: initialBookings } : { status: "loading" });
  const [requests, setRequests] = useState<ActivityState<OperatorRequest>>(initialRequests ? { status: "loaded", total: initialRequests.length, items: [...initialRequests].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)) } : { status: "loading" });

  useEffect(() => {
    let active = true;
    void loadBookings().then((result) => { if (active) setBookings(result); });
    void loadRequests().then((result) => { if (active) setRequests(result); });
    return () => { active = false; };
  }, []);

  return <>
    <ActivityCard
      title="Bookings"
      icon="calendar"
      noun="booking"
      state={bookings}
      listLabel="Latest bookings"
      emptyText="There are no booking records to review."
      loadingText="Loading bookings…"
      errorText="Bookings could not be loaded."
      href="/app/bookings"
      action="Open workspace"
      renderItem={(booking) => <li key={booking.id} className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
        <span className="min-w-0">
          <strong className="block break-words text-base font-bold">{booking.inviteeName}</strong>
          <small className="block break-words text-sm text-muted">{booking.imported ? "Imported · " : ""}{booking.eventTitle} · {displayBookingTime(booking)}</small>
        </span>
        <Badge tone={booking.state === "cancelled" ? "danger" : booking.state === "rescheduled" ? "warning" : "success"}>{booking.state}</Badge>
      </li>}
    />
    <ActivityCard
      title="Alternative requests"
      icon="mail"
      noun="request"
      state={requests}
      listLabel="Latest requests"
      emptyText="There are no request records to review."
      loadingText="Loading requests…"
      errorText="Requests could not be loaded."
      href="/app/requests"
      action="Open inbox"
      renderItem={(request) => <li key={request.id} className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
        <span className="min-w-0">
          <strong className="block break-words text-base font-bold">{request.inviteeName}</strong>
          <small className="block break-words text-sm text-muted">{request.eventTitle} · {request.windows.length} requested {request.windows.length === 1 ? "window" : "windows"}</small>
        </span>
        <Badge tone={request.state === "submitted" ? "warning" : request.state === "handled" ? "success" : "neutral"}>{request.state}</Badge>
      </li>}
    />
  </>;
}

function ActivityCard<T>({
  title,
  icon,
  noun,
  state,
  listLabel,
  emptyText,
  loadingText,
  errorText,
  href,
  action,
  renderItem,
}: {
  title: string;
  icon: IconName;
  noun: string;
  state: ActivityState<T>;
  listLabel: string;
  emptyText: string;
  loadingText: string;
  errorText: string;
  href: "/app/bookings" | "/app/requests";
  action: string;
  renderItem: (item: T) => ReactNode;
}) {
  const description = state.status === "loading"
    ? "Loading…"
    : state.status === "error"
      ? `${noun === "booking" ? "Bookings" : "Requests"} unavailable.`
      : `${state.total} ${state.total === 1 ? noun : `${noun}s`}`;

  return <Card className="min-w-0 p-5 sm:p-6">
    <SectionHeading icon={icon} title={title} description={description} action={<Link to={href} className={`${textLinkClassName} text-[15px]`}>{action}</Link>} />
    {state.status === "loading" ? <WorkspaceLoadState label={loadingText} /> : null}
    {state.status === "error" ? <WorkspaceLoadState error={errorText} /> : null}
    {state.status === "loaded" && state.total === 0 ? <p className="mt-5 text-sm leading-6 text-soft">{emptyText}</p> : null}
    {state.status === "loaded" && state.items.length > 0 ? <ul aria-label={listLabel} className="mt-4 divide-y divide-line-soft">{state.items.slice(0, 3).map(renderItem)}</ul> : null}
  </Card>;
}

async function loadBookings(): Promise<ActivityState<BookingRecord>> {
  try {
    const response = await api.api.app.bookings.$get({ query: { order: "created", limit: "3" } });
    if (!response.ok) throw new Error(await errorMessage(response));
    const totalCountHeader = response.headers.get("x-total-count");
    if (!totalCountHeader || !/^\d+$/u.test(totalCountHeader)) throw new Error("The booking count was not returned.");
    const total = Number(totalCountHeader);
    if (!Number.isSafeInteger(total)) throw new Error("The booking count is not a safe integer.");
    const items = await response.json() as BookingRecord[];
    if (total < items.length || (total === 0) !== (items.length === 0)) throw new Error("The booking count did not match its records.");
    return { status: "loaded", total, items };
  } catch {
    return { status: "error" };
  }
}

async function loadRequests(): Promise<ActivityState<OperatorRequest>> {
  try {
    const response = await api.api.app["availability-requests"].$get({ query: {} });
    if (!response.ok) throw new Error(await errorMessage(response));
    const items = await response.json() as OperatorRequest[];
    if (!Array.isArray(items)) throw new Error("The request list was not returned.");
    items.sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));
    return { status: "loaded", total: items.length, items };
  } catch {
    return { status: "error" };
  }
}

function displayBookingTime(booking: BookingRecord) {
  return new Intl.DateTimeFormat("en-US", { timeZone: booking.inviteeTimezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.occurrence.startAt));
}
