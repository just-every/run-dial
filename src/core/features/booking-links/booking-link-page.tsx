import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../api/client";
import { useWorkspaceRead } from "../../app/workspace-reads";
import { WorkspaceLoadState } from "../../app/ui/route-load-error";
import type { EventTypeRecord } from "../event-types";
import { OfferedTimesPanel } from "./offered-times-ui";
import { BookingLinksPanel } from "./ui";

export function OfferedTimesPage() {
  return <BookingLinkPage title="Offer specific times">{events => <OfferedTimesPanel events={events} />}</BookingLinkPage>;
}

export function PrivateLinkPage() {
  return <BookingLinkPage title="Private link">{events => <BookingLinksPanel events={events} />}</BookingLinkPage>;
}

function BookingLinkPage({ title, children }: { title: string; children(events: EventTypeRecord[]): ReactNode }) {
  const initial = useWorkspaceRead<EventTypeRecord[]>("/api/app/event-types");
  const [events, setEvents] = useState(initial), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api.api.app["event-types"].$get({}, { init: { signal: controller.signal } }).then(async response => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json();
      if (!controller.signal.aborted) { setEvents(result); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("Event types could not be loaded."); });
    return () => controller.abort();
  }, [revision]);
  return <div className="grid min-w-0 gap-6">
    <header className="grid gap-3"><Link to="/app/bookings" className="flex min-h-11 w-fit items-center text-sm font-semibold">‹ Bookings</Link><h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] sm:text-[40px]">{title}</h1></header>
    {events === undefined ? <WorkspaceLoadState error={error} label="Checking event types…" onRetry={() => setRevision(value => value + 1)} /> : <>{error ? <WorkspaceLoadState error={error} onRetry={() => setRevision(value => value + 1)} /> : null}{children(events)}</>}
  </div>;
}
