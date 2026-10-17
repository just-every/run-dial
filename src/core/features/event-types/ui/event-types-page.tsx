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
import { Badge, Button, Card, buttonClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import { hostSetupChanged } from "../../host-setup";
import type { EventTypeRecord } from "../repository";

export function EventTypesPage({ workspace = "/app" }: { workspace?: "/app" | "/setup" }) {
  const setup = useHostSetup();
  const initialEvents = useWorkspaceRead<EventTypeRecord[]>("/api/app/event-types");
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[] | undefined>(initialEvents);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.api.app["event-types"].$get().then(async (response) => {
      if (response.ok) setEventTypes(await response.json());
      else setError(await errorMessage(response));
    });
  }, []);

  return (
    <div className="grid gap-7">
      <PageHeader eyebrow="Scheduling offers" title="Event types" description="Create and maintain the booking experiences guests can select." actions={<Link to={`${workspace}/event-types/new`} className={buttonClassName()}>New event type</Link>} />
      {setup.error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{setup.error}</p> : null}
      {error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
      {eventTypes === undefined ? <p role="status" className="text-sm text-muted">Loading event types…</p> : eventTypes.length === 0 ? <EmptyState title="No event types yet" description="Create your first event type to begin configuring availability and public booking." action={<Link to={`${workspace}/event-types/new`} className={buttonClassName()}>New event type</Link>} /> : <div className="grid gap-4">{eventTypes.map((eventType) => <EventTypeRow workspace={workspace} link={setup.state?.links.find((link) => link.eventTypeId === eventType.id)} eventType={eventType} key={eventType.id} />)}</div>}
      {workspace === "/app" && eventTypes ? <BookingLinksPanel events={eventTypes} /> : null}
    </div>
  );
}

function EventTypeRow({ eventType, link, workspace }: { workspace: "/app" | "/setup"; eventType: EventTypeRecord; link?: BookingLink }) {
  const navigate = useNavigate(), hydrated = useHydrated(), inFlight = useRef(false);
  const [duplicating, setDuplicating] = useState(false), [error, setError] = useState("");
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
  const tone = eventType.status === "published" ? "success" : eventType.status === "disabled" ? "danger" : "warning";
  return <Card className="p-5 sm:flex sm:p-6 sm:items-center sm:justify-between sm:gap-5"><div className="flex min-w-0 gap-4"><span aria-hidden="true" className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ backgroundColor: eventType.color }} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[19px] font-[750] tracking-[-.01em]">{eventType.title}</h2><Badge tone={tone}>{eventType.requestOnly && eventType.status === "published" ? "Requests only" : eventType.status}</Badge></div><p className="mt-1 max-w-2xl text-sm leading-6 text-soft">{eventType.description}</p><p className="mt-3 text-sm font-[650] text-ink">{eventType.durationMinutes} minutes · {offeredLocations(eventType).map(location => location.label).join(" or ")} · {eventType.listed ? "Listed on profile" : "Unlisted link only"}</p></div></div><div className="mt-4 flex shrink-0 flex-wrap gap-2 sm:mt-0">{link ? <CopyBookingLink link={link} /> : null}<Button type="button" variant="quiet" disabled={!hydrated || duplicating} aria-label={`Duplicate ${eventType.title}`} onClick={() => void duplicate()}>{duplicating ? "Duplicating…" : "Duplicate"}</Button><Link to={`${workspace}/event-types/$id`} params={{ id: eventType.id }} className={buttonClassName("quiet")}>Edit</Link><Link to={`${workspace}/event-types/$id/availability`} params={{ id: eventType.id }} className={buttonClassName("quiet")}>Availability</Link>{error ? <p role="alert" className="basis-full text-sm text-danger">{error}</p> : null}</div></Card>;
}
