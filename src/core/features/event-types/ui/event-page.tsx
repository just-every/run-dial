import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouteContext } from "@tanstack/react-router";
import { api, errorMessage } from "../../../api/client";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { useDetailsDraft } from "./advanced-groups/details-draft";
import { Card, IconTile } from "../../../app/ui/primitives";
import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { RecordNotFound } from "../../bookings/client";
import { EventSharing, hostSetupChanged } from "../../host-setup";
import type { HoursRead } from "../../availability";
import type { EventDetailsInput, EventTypeRecord } from "../repository";
import { EventFields } from "./event-fields";
import { EventActions, type EventReadiness } from "./event-actions";
import { EventPageContext, type EventPaymentEditor } from "./event-page-context";
import { hoursSummary } from "./hours-summary";
import { eventDurationOptions } from "../../../shared/event-duration";
import { publicLocations } from "../locations";

type EventPageProps = { eventId: string; workspace?: "/app" | "/setup"; paymentEditor: EventPaymentEditor; children?: ReactNode };
export function EventPage(props: EventPageProps) { return <EventPageLoader key={props.eventId} {...props} />; }
function EventPageLoader({ eventId, workspace = "/app", paymentEditor, children }: EventPageProps) {
  const initial = useWorkspaceRead<EventTypeRecord>(`/api/app/event-types/${eventId}`);
  const [event, setEvent] = useState<EventTypeRecord | undefined>(initial);
  const [error, setError] = useState(""), [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.api.app["event-types"][":id"].$get({ param: { id: eventId } });
      if (!response.ok) { setMissing([400, 404].includes(response.status)); throw new Error(await errorMessage(response)); }
      const record = await response.json();
      setEvent(current => current ?? record);
    } catch { setError("The event could not be loaded. Try again."); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);
  if (missing || eventId.length !== 26) return <RecordNotFound kind="event type" back="/app/event-types" />;
  if (!event) return <WorkspaceLoadState label="Loading event…" error={error} onRetry={load} />;
  return <EventPageForm key={eventId} initial={event} workspace={workspace} paymentEditor={paymentEditor}>{children}</EventPageForm>;
}
function detailsOf(event: EventTypeRecord): EventDetailsInput {
  const details: Partial<EventTypeRecord> = { ...event };
  for (const key of ["availability", "alternativeRequestsEnabled", "status", "id", "createdAt", "updatedAt", "requestOnly", "bookingPolicy"] as const) delete details[key];
  return details as EventDetailsInput;
}
function EventPageForm({ initial, workspace, paymentEditor, children }: { initial: EventTypeRecord; workspace: "/app" | "/setup"; paymentEditor: EventPaymentEditor; children?: ReactNode }) {
  const [record, setRecord] = useState(initial);
  const initialReadiness = useWorkspaceRead<EventReadiness>(`/api/app/event-types/${initial.id}/readiness`);
  const [readiness, setReadiness] = useState(initialReadiness), [checking, setChecking] = useState(!initialReadiness);
  const [hours, setHours] = useState<HoursRead | null>();
  const initialFields = useWorkspaceRead<{ id: string }[]>(`/api/app/custom-fields/eventType/${initial.id}`);
  const [hasPrivateFields, setHasPrivateFields] = useState(Boolean(initialFields?.length));
  const readinessEpoch = useRef(0);
  const hoursReadEpoch = useRef(0);
  const shell = useRouteContext({ strict: false }).shell;
  const hostName = shell?.profile?.name ?? "";
  const hostTimezone = shell?.profile?.timezone ?? "UTC";
  const checkReadiness = useCallback(async () => {
    const epoch = ++readinessEpoch.current;
    setChecking(true);
    try {
      const response = await api.api.app["event-types"][":id"].readiness.$get({ param: { id: initial.id } });
      if (!response.ok) throw new Error("Readiness unavailable");
      const current = await response.json();
      if (epoch === readinessEpoch.current) setReadiness(current);
    } catch { if (epoch === readinessEpoch.current) setReadiness(undefined); }
    finally { if (epoch === readinessEpoch.current) setChecking(false); }
  }, [initial.id]);
  const onSaved = useCallback(() => { void checkReadiness(); hostSetupChanged(); }, [checkReadiness]);
  const onHoursClosed = useCallback(() => {
    const epoch = ++hoursReadEpoch.current;
    void api.api.app["event-types"][":id"].$get({ param: { id: initial.id } }).then(async response => {
      if (!response.ok) return;
      const fresh = await response.json();
      if (epoch === hoursReadEpoch.current) setRecord(current => ({ ...current, availability: fresh.availability }));
    }).catch(() => { /* Keep the last known hours when the refresh is unavailable. */ });
    onSaved();
  }, [initial.id, onSaved]);
  useEffect(() => { void checkReadiness(); return () => { readinessEpoch.current++; }; }, [checkReadiness]);
  useEffect(() => {
    let active = true;
    let readEpoch = 0;
    const loadHours = async () => {
      const epoch = ++readEpoch;
      try {
        const [hoursRead, fieldsRead] = await Promise.allSettled([api.api.app.hours.$get(), fetch(`/api/app/custom-fields/eventType/${initial.id}`)]);
        if (hoursRead.status === "fulfilled" && hoursRead.value.ok) { const current = await hoursRead.value.json(); if (active && epoch === readEpoch) setHours(current); }
        else if (active && epoch === readEpoch) setHours(current => current ?? null);
        if (fieldsRead.status === "fulfilled" && fieldsRead.value.ok) { const fields = await fieldsRead.value.json() as { id: string }[]; if (active && epoch === readEpoch) setHasPrivateFields(fields.length > 0); }
      } catch { if (active && epoch === readEpoch) setHours(current => current ?? null); }
    };
    void loadHours();
    window.addEventListener("dial-host-setup-changed", loadHours);
    return () => { active = false; window.removeEventListener("dial-host-setup-changed", loadHours); };
  }, [initial.id]);
  // Lifecycle actions flush details first; a changed lifecycle then gets the right address-confirm policy.
  return <EventDetailsScope key={`${initial.id}:${record.status}`} initial={record} workspace={workspace} paymentEditor={paymentEditor} hostName={hostName} hostTimezone={hostTimezone} onSaved={onSaved} onHoursClosed={onHoursClosed} readiness={readiness} checking={checking} setRecord={setRecord} hours={hours} hasPrivateFields={hasPrivateFields}>{children}</EventDetailsScope>;
}
type DetailsScopeProps = { initial: EventTypeRecord; workspace: "/app" | "/setup"; paymentEditor: EventPaymentEditor; hostName: string; hostTimezone: string; onSaved(): void; onHoursClosed(): void; readiness?: EventReadiness; checking: boolean; setRecord(event: EventTypeRecord): void; hours?: HoursRead | null; hasPrivateFields: boolean; children?: ReactNode };
function EventDetailsScope({ initial, workspace, paymentEditor, hostName, hostTimezone, onSaved, onHoursClosed, readiness, checking, setRecord, hours, hasPrivateFields, children }: DetailsScopeProps) {
  const details = useDetailsDraft(`event:${initial.id}:details:${initial.status}`, detailsOf(initial), async (next, init) => {
    const response = await api.api.app["event-types"][":id"].details.$patch({ param: { id: initial.id }, json: next }, { init });
    if (!response.ok) throw new Error(await errorMessage(response));
    onSaved();
  }, initial.status === "published" ? ["slug"] : []);
  const event = { ...initial, ...details.values };
  return <EventPageContext.Provider value={{ event, details, workspace, hostName, hostTimezone, onSaved, onHoursClosed, paymentEditor }}>
    <div className="grid gap-5" data-event-page>
      <Link to={`${workspace}/event-types`} className="inline-flex min-h-11 sm:min-h-6 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline">‹ Event types</Link>
      <EventActions event={event} workspace={workspace} readiness={readiness} checking={checking} onChange={setRecord} onSaved={onSaved} />
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,350px)]">
        <Card className="min-w-0 p-5 sm:p-6"><EventFields mode="essentials" event={event} update={details.type} choose={details.choose} state={details.state} validation={details.validation} onLeave={details.leave} onRetry={details.retry} /></Card>
        <Card className="min-w-0 p-5 sm:p-6"><h2 className="text-[13px] font-bold uppercase tracking-[.1em] text-muted">As invitees see it</h2><div className="my-4 grid gap-3 rounded-2xl bg-gold-wash p-4"><h3 className="break-words text-[22px] font-bold leading-tight">{event.title}</h3><p className="whitespace-pre-wrap break-words text-sm leading-6 text-soft">{event.description}</p><div className="flex flex-wrap gap-2 text-[13px] font-semibold"><span className="rounded-full bg-card px-3 py-1.5">{eventDurationOptions(event).map(minutes => `${minutes} min`).join(" / ")}</span><span className="rounded-full bg-card px-3 py-1.5">{publicLocations(event).map(location => location.label).join(" / ")}</span></div></div><EventSharing eventId={event.id} workspace={workspace} /></Card>
        <Card className="min-w-0 p-2 xl:col-start-1"><SettingsRow id="event-hours-row" to={`${workspace}/event-types/${event.id}/hours`} icon="clock" title="Hours" summary={hoursSummary(event, hours)} /><SettingsRow id="event-advanced-row" to={`${workspace}/event-types/${event.id}/advanced`} icon="gear" title="Advanced settings" summary={`Price, questions, guests, emails and ${hasPrivateFields ? 5 : 4} more`} /></Card>
      </div>
    </div>
    {children}
  </EventPageContext.Provider>;
}
function SettingsRow({ id, to, icon, title, summary }: { id: string; to: string; icon: "clock" | "gear"; title: string; summary: string }) {
  return <Link id={id} to={to} state={{ eventSettingsFrom: to.slice(0, to.lastIndexOf("/")) }} className="flex min-h-[88px] sm:min-h-[72px] items-center gap-3 rounded-2xl p-3 text-left hover:bg-row focus-visible:outline-2 focus-visible:outline-ink"><IconTile icon={icon} /><span className="min-w-0 flex-1"><span className="block font-bold">{title}</span><span className="mt-1 block text-sm leading-5 text-soft">{summary}</span></span><span aria-hidden="true" className="text-xl">›</span></Link>;
}
