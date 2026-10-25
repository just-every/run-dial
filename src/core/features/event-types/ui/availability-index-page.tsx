import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Card, IconTile, buttonClassName } from "../../../app/ui/primitives";
import type { EventTypeRecord } from "../repository";

export function AvailabilityIndexPage() {
  const initialEvents = useWorkspaceRead<EventTypeRecord[]>("/api/app/event-types");
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[] | undefined>(initialEvents);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { void api.api.app["event-types"].$get().then(async (response) => { if (response.ok) setEventTypes(await response.json()); else setError(await errorMessage(response)); }).catch(() => setError("Event types could not be loaded.")); }, [revision]);
  return <div className="grid gap-7"><PageHeader eyebrow="Scheduling rules" title="Availability" description="Availability belongs to each event type. Choose an offer to set its recurring host-timezone windows." />{error && eventTypes !== undefined ? <WorkspaceLoadState error={error} onRetry={() => { setError(""); setRevision(value => value + 1); }} /> : null}{eventTypes === undefined ? <WorkspaceLoadState error={error} label="Loading event types…" onRetry={() => { setError(""); setRevision(value => value + 1); }} /> : eventTypes.length === 0 ? <EmptyState title="Create an event type first" description="Recurring availability is configured on each event type." action={<Link to="/app/event-types/new" className={buttonClassName()}>New event type</Link>} /> : <div className="grid gap-3">{eventTypes.map((eventType) => <Card key={eventType.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div className="flex items-start gap-3"><IconTile icon="clock" /><div className="pt-0.5"><h2 className="text-[17px] font-bold">{eventType.title}</h2><p className="mt-1 text-sm text-muted">{eventType.availability.length} configured recurring window{eventType.availability.length === 1 ? "" : "s"}</p></div></div><Link to="/app/event-types/$id/availability" params={{ id: eventType.id }} className={buttonClassName("secondary")}>Edit availability</Link></Card>)}</div>}</div>;
}
