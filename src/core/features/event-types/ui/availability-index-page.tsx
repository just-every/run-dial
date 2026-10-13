import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Card, IconTile, buttonClassName } from "../../../app/ui/primitives";
import type { EventTypeRecord } from "../repository";

export function AvailabilityIndexPage() {
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[]>();
  const [error, setError] = useState("");
  useEffect(() => { void api.api.app["event-types"].$get().then(async (response) => { if (response.ok) setEventTypes(await response.json()); else setError(await errorMessage(response)); }); }, []);
  return <div className="grid gap-7"><PageHeader eyebrow="Scheduling rules" title="Availability" description="Availability belongs to each event type. Choose an offer to set its recurring host-timezone windows." />{error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}{eventTypes === undefined ? <p role="status" className="text-sm text-muted">Loading event types…</p> : eventTypes.length === 0 ? <EmptyState title="Create an event type first" description="Recurring availability is configured on each event type." action={<Link to="/app/event-types/new" className={buttonClassName()}>New event type</Link>} /> : <div className="grid gap-3">{eventTypes.map((eventType) => <Card key={eventType.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div className="flex items-start gap-3"><IconTile icon="clock" /><div className="pt-0.5"><h2 className="text-[17px] font-bold">{eventType.title}</h2><p className="mt-1 text-sm text-muted">{eventType.availability.length} configured recurring window{eventType.availability.length === 1 ? "" : "s"}</p></div></div><Link to="/app/event-types/$id/availability" params={{ id: eventType.id }} className={buttonClassName("secondary")}>Edit availability</Link></Card>)}</div>}</div>;
}
