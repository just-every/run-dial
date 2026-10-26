import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { OfferedTimesPanel } from "../../booking-links/client";
import { offeredLocations } from "../locations";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { BookingLinksPanel } from "../../booking-links/client";
import { useHostSetup } from "../../host-setup";
import { CopyBookingLink } from "../../host-setup";
import type { BookingLink } from "../../host-setup";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Button, Card, buttonClassName } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import { useHydrated } from "../../../app/use-hydrated";
import { hostSetupChanged } from "../../host-setup";
import type { EventTypeRecord } from "../repository";

export function EventTypesPage({ workspace = "/app" }: { workspace?: "/app" | "/setup" }) {
  const setup = useHostSetup();
  const initialEvents = useWorkspaceRead<EventTypeRecord[]>("/api/app/event-types");
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[] | undefined>(initialEvents);
  const [error, setError] = useState("");

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    void api.api.app["event-types"].$get().then(async (response) => {
      if (response.ok) setEventTypes(await response.json());
      else setError(await errorMessage(response));
    }).catch(() => setError("Event types could not be loaded."));
  }, [revision]);

  return (
    <div className="grid gap-7">
      <PageHeader title="Event types" description="Create and maintain the booking experiences guests can select." actions={<Link to={`${workspace}/event-types/new`} className={buttonClassName()}>New event type</Link>} />
      {setup.error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{setup.error}</p> : null}
      {error && eventTypes !== undefined ? <WorkspaceLoadState error={error} onRetry={() => { setError(""); setRevision(value => value + 1); }} /> : null}
      {eventTypes === undefined ? <WorkspaceLoadState error={error} label="Loading event types…" onRetry={() => { setError(""); setRevision(value => value + 1); }} /> : eventTypes.length === 0 ? <EmptyState title="No event types yet" description="Create your first event type to begin configuring availability and public booking." action={<Link to={`${workspace}/event-types/new`} className={buttonClassName()}>New event type</Link>} /> : <div className="grid gap-4">{eventTypes.map((eventType) => <EventTypeRow workspace={workspace} link={setup.state?.links.find((link) => link.eventTypeId === eventType.id)} eventType={eventType} key={eventType.id} />)}</div>}
      {workspace === "/app" && eventTypes ? <><OfferedTimesPanel events={eventTypes} /><BookingLinksPanel events={eventTypes} /></> : null}
    </div>
  );
}

function EventTypeRow({ eventType, link, workspace }: { workspace: "/app" | "/setup"; eventType: EventTypeRecord; link?: BookingLink }) {
  const navigate = useNavigate(), hydrated = useHydrated(), inFlight = useRef(false);
  const [duplicating, setDuplicating] = useState(false), [error, setError] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  async function duplicate() {
    if (inFlight.current) return;
    inFlight.current = true; setDuplicating(true); setError("");
    try {
      const response = await api.api.app["event-types"][":id"].duplicate.$post({ param: { id: eventType.id } });
      if (response.status !== 201) { setError(await errorMessage(response)); return; }
      const copied = await response.json();
      hostSetupChanged();
      await navigate({ to: `${workspace}/event-types/$id`, params: { id: copied.id } });
    } catch { setError("The copy could not be opened. Reload the event list to check whether it was created."); }
    finally { inFlight.current = false; setDuplicating(false); }
  }
  const status = eventType.status === "published" ? eventType.requestOnly ? "Requests only" : undefined : eventType.status;
  const actionsId = `event-actions-${eventType.id}`;
  return <Card className="dial-event-card p-5 sm:flex sm:p-6 sm:items-center sm:justify-between sm:gap-5">
    <div className="flex min-w-0 gap-4">
      <span aria-hidden="true" className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ backgroundColor: eventType.color }} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-[750] tracking-[-.01em]">{eventType.title}</h2>
          {status ? <span className="text-sm text-soft">{status}</span> : null}
        </div>
        <p className="mt-1 truncate text-sm leading-6 text-soft">{eventType.durationMinutes} minutes · {offeredLocations(eventType).map(location => location.label).join(" or ")} · {eventType.listed ? "Listed on profile" : "Unlisted link only"}</p>
      </div>
    </div>
    <div className="dial-event-controls mt-4 flex shrink-0 flex-wrap gap-2 sm:mt-0">
      <Tooltip label="More actions">
        <button type="button" className="dial-event-more inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink hover:bg-wash" disabled={!hydrated} aria-expanded={actionsOpen} aria-controls={actionsId} onClick={() => setActionsOpen(open => !open)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
        </button>
      </Tooltip>
      <div id={actionsId} className="dial-event-actions flex flex-wrap gap-2" data-open={actionsOpen}>
        {link ? <CopyBookingLink link={link} /> : null}
        <Button type="button" variant="quiet" disabled={!hydrated || duplicating} aria-label={`Duplicate ${eventType.title}`} onClick={() => void duplicate()}>{duplicating ? "Duplicating…" : "Duplicate"}</Button>
        <Link to={`${workspace}/event-types/$id`} params={{ id: eventType.id }} className={buttonClassName("quiet")}>Edit</Link>
        <Link to={`${workspace}/event-types/$id/availability`} params={{ id: eventType.id }} className={buttonClassName("quiet")}>Availability</Link>
      </div>
      {error ? <p role="alert" className="basis-full text-sm text-danger">{error}</p> : null}
    </div>
  </Card>;
}
