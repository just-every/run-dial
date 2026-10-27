import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Card, Select, textLinkClassName } from "../../../app/ui/primitives";
import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { RecordNotFound } from "../../bookings/client";
import type { EventTypeRecord } from "../../event-types";
import type { HoursRead } from "../your-hours";
import type { BookingLimitsConfig } from "../booking-limits";
import { WeeklyHours, hoursSummary } from "./weekly-hours";
import { BookingCaps, capsSummary } from "./booking-caps";
import { DateChanges } from "./date-changes";
import { HoursRow } from "./hours-row";

type Read = { hours: HoursRead; event: EventTypeRecord; limits: BookingLimitsConfig };

function useEventHours(eventId: string) {
  const [data, setData] = useState<Read>();
  const [error, setError] = useState(false), [missing, setMissing] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const token = ++epoch.current;
    setError(false);
    try {
      const responses = await Promise.all([api.api.app.hours.$get(), api.api.app["event-types"][":id"].$get({ param: { id: eventId } }), api.api.app["booking-limits"][":scope"].$get({ param: { scope: eventId } })]);
      if (token !== epoch.current) return;
      if (responses[1].status === 404 || responses[1].status === 400) { setMissing(true); return; }
      if (responses.some(response => !response.ok)) throw new Error();
      const [hours, event, limits] = await Promise.all(responses.map(response => response.json())) as [HoursRead, EventTypeRecord, BookingLimitsConfig];
      if (token === epoch.current) setData(current => current ?? { hours, event, limits });
    } catch { if (token === epoch.current) setError(true); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  return { data, error, missing, load };
}

/** Content only: the event route supplies its sheet and scheduling controls. */
export function EventHours({ eventId }: { eventId: string }) {
  const read = useEventHours(eventId);
  if (read.missing) return <RecordNotFound kind="event type" back="/app/event-types" />;
  return read.data ? <HoursContent key={eventId} data={read.data} /> : <WorkspaceLoadState error={read.error} label="Loading hours…" onRetry={read.load} />;
}

/** Until the event sheet lands, its existing address remains a complete page. */
export function EventHoursPage({ eventId, workspace = "/app" }: { eventId: string; workspace?: "/app" | "/setup" }) {
  const read = useEventHours(eventId);
  if (read.missing) return <RecordNotFound kind="event type" back="/app/event-types" />;
  if (!read.data) return <WorkspaceLoadState error={read.error} label="Loading hours…" onRetry={read.load} />;
  return <div className="grid min-w-0 gap-6">
    <Link to={`${workspace}/event-types/$id`} params={{ id: eventId }} aria-label="Back to event" className={`${textLinkClassName} flex min-h-11 w-fit items-center`}>‹ {read.data.event.title}</Link>
    <PageHeader title={`${read.data.event.title}’s hours`} description="" />
    <HoursContent key={eventId} data={read.data} />
  </div>;
}

function HoursContent({ data }: { data: Read }) {
  const { event, hours } = data;
  const [caps, setCaps] = useState(data.limits);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const uses = hours.events.find(item => item.id === event.id)?.uses ?? "own";
  const server = useRef({ uses, windows: event.availability, copy: 0 });
  const applyCopy = useRef<((windows: EventTypeRecord["availability"]) => void) | null>(null);
  const form = useAutosave(`event-hours:${event.id}`, { uses, windows: event.availability, copy: { source: "", turn: 0 } }, async (next, init) => {
    if (next.uses === "own" && next.copy.turn === server.current.copy && next.windows.some(window => window.endMinute <= window.startMinute)) throw new Error("Ends before it starts. Choose a later end time.");
    const copying = next.copy.turn !== server.current.copy;
    if (next.uses !== server.current.uses || copying) {
      const response = await api.api.app["event-types"][":id"].hours.$put({ param: { id: event.id }, json: next.uses === "own" ? { uses: "own", ...copying ? { startFrom: next.copy.source } : {} } : { uses: next.uses } }, { init });
      if (!response.ok) throw new Error(await errorMessage(response));
      const stored = await response.json();
      server.current = { uses: next.uses, windows: stored.availability, copy: next.copy.turn };
      if (copying) applyCopy.current?.(stored.availability);
    }
    if (next.uses === "own" && !copying && JSON.stringify(next.windows) !== JSON.stringify(server.current.windows)) {
      const response = await api.api.app["event-types"][":id"].availability.$put({ param: { id: event.id }, json: { windows: next.windows } }, { init });
      if (!response.ok) throw new Error(await errorMessage(response));
      server.current.windows = next.windows;
    }
  });
  useEffect(() => { applyCopy.current = windows => form.choose("windows", windows); }, [form.choose]);
  const options = [{ id: "yours", name: "Your hours", windows: hours.yours?.windows ?? [] }, ...hours.others.map(other => ({ id: other.id, name: other.name, windows: other.windows })), { id: "own", name: "Its own hours", windows: form.values.windows }];
  const saved = form.state("windows").saved ? form.state("windows") : form.state("copy");
  return <div className="grid min-w-0 gap-5">
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-3 flex w-full items-center justify-between text-sm font-semibold">Hours{profile?.timezone ? ` · ${profile.timezone.replaceAll("_", " ")}` : ""}<SavedMark state={form.state("uses")} /></legend>
      <div className="grid gap-3 sm:grid-cols-2">{options.map(option => <label key={option.id} className={`relative min-w-0 cursor-pointer rounded-[18px] p-4 ${form.values.uses === option.id ? "bg-gold-wash" : "bg-card shadow-panel"}`}>
        <input className="peer absolute inset-0 m-0 cursor-pointer opacity-0" type="radio" name={`hours-${event.id}`} value={option.id} checked={form.values.uses === option.id} aria-label={option.name} onChange={() => form.choose("uses", option.id)} />
        <span className="block min-h-11 rounded-lg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ink"><span className="block font-bold">{option.name}</span><span className="mt-1 block text-sm text-soft">{hoursSummary(option.windows)}</span></span>
      </label>)}</div>
      <SaveFailed id="event-hours-choice-failed" state={form.state("uses")} what="hours choice" choice onRetry={form.retry} />
    </fieldset>
    <div hidden={form.values.uses !== "own"}>
      <Card className="min-w-0 p-5 sm:p-6">
        <SectionHeading title={`${event.title}’s hours`} action={<SavedMark state={saved} />} />
        <p className="mb-5 mt-2 text-sm text-soft">Only this event uses these. Time off and holidays are yours, in <Link to="/app/settings/hours" className={textLinkClassName}>Settings › Hours</Link>.</p>
        <WeeklyHours windows={form.values.windows} onChange={windows => form.choose("windows", windows)} />
        <SaveFailed id="event-windows-failed" state={form.state("windows")} what="weekly hours" choice onRetry={form.retry} />
        <label className="mt-5 grid content-start gap-2 text-sm font-semibold">Start from<Select aria-label="Start from" value="" onChange={change => { if (change.target.value) form.choose("copy", { source: change.target.value, turn: form.values.copy.turn + 1 }); }}><option value="">Choose hours to copy</option><option value="yours">Your hours</option>{hours.events.filter(item => item.id !== event.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label>
        <SaveFailed id="event-copy-failed" state={form.state("copy")} what="starting hours" choice onRetry={form.retry} />
      </Card>
    </div>
    <Card className="min-w-0 overflow-visible py-1">
      <HoursRow title="Dates that differ" summary="Open or close a single date for this event" icon="overrides"><DateChanges eventId={event.id} timezone={profile?.timezone} /></HoursRow>
      <HoursRow title="Limits" summary={capsSummary(caps)}><BookingCaps scope={event.id} initial={data.limits} onSaved={setCaps} /></HoursRow>
    </Card>
  </div>;
}
