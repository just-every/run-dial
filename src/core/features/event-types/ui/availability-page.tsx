import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Badge, Button, Card, Input, buttonClassName } from "../../../app/ui/primitives";
import type { AvailabilityWindowInput, EventTypeRecord } from "../repository";
import { useHydrated } from "../../../app/use-hydrated";
import { timeInput, timeMinutes } from "./window-time";
import { DateOverrideEditor } from "./date-override-editor";
import { ScheduleControls } from "./schedule-controls";
import { BookingLimitFields } from "./booking-limit-fields";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AvailabilityPage({ eventId, workspace = "/app" }: { eventId: string; workspace?: "/app" | "/setup" }) {
  return <AvailabilityForm key={eventId} eventId={eventId} workspace={workspace} />;
}
function AvailabilityForm({ eventId, workspace = "/app" }: { eventId: string; workspace?: "/app" | "/setup" }) {
  const hydrated = useHydrated();
  const inFlight = useRef(false);
  const loadEpoch = useRef(0);
  const edited = useRef(false);
  const navigate = useNavigate();
  const [eventType, setEventType] = useState<EventTypeRecord>();
  const [timezone, setTimezone] = useState<string | null>();
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    setError(""); setMissing(false);
    try {
      const [eventResponse, profileResponse] = await Promise.all([api.api.app["event-types"][":id"].$get({ param: { id: eventId } }), api.api.app.profile.$get()]);
      if (epoch !== loadEpoch.current) return;
      if (!eventResponse.ok || !profileResponse.ok) { setMissing(eventResponse.status === 404 || eventResponse.status === 400); const message = await errorMessage(!eventResponse.ok ? eventResponse : profileResponse); if (epoch === loadEpoch.current) setError(message); return; }
      const [record, profile] = await Promise.all([eventResponse.json(), profileResponse.json()]);
      if (epoch !== loadEpoch.current || edited.current) return;
      setEventType((current) => current ?? record); setTimezone(profile?.timezone ?? null);
    } catch { if (epoch === loadEpoch.current) setError("Availability could not be loaded. Reload to try again."); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { loadEpoch.current += 1; }; }, [load]);

  if (timezone === null) return error ? <EmptyState tone="error" title="Availability unavailable" description={error} action={<Button type="button" disabled={!hydrated} onClick={() => void load()}>Reload availability</Button>} /> : <EmptyState title="Configure the host profile" description="Set the host timezone before editing availability." action={<Link to={`${workspace}/profile`} className={buttonClassName()}>Set up host profile</Link>} />;

  if (!eventType) return missing ? <EmptyState title="Event unavailable" description="This event could not be found." action={<Link to={`${workspace}/event-types`} className={buttonClassName("secondary")}>Event types</Link>} /> : <WorkspaceLoadState error={error} label="Loading availability…" onRetry={() => load()} />;

  const currentEventType = eventType;
  const update = (availability: AvailabilityWindowInput[]) => {
    edited.current = true;
    setEventType({ ...currentEventType, availability });
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !hydrated || !timezone) return;
    inFlight.current = true; setSaving(true); setError("");
    let saved = false;
    try {
      const response = await api.api.app["event-types"][":id"].availability.$put({ param: { id: eventId }, json: { windows: currentEventType.availability } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setEventType(await response.json());
      saved = true;
      await navigate({ to: `${workspace}/event-types/$id`, params: { id: eventId } });
    } catch { setError(saved ? "Your recurring availability was saved. Return to the event to open it again." : "The save result could not be received. Your windows are kept here; save again to apply this same schedule."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return (
    <div className="grid gap-7"><form className="grid gap-7" onSubmit={(event) => void save(event)}>
      <PageHeader
        eyebrow="Event type availability"
        title="Availability"
        description={`Set weekly windows and date-specific exceptions for ${eventType.title}. Every window is interpreted in the host timezone.`}
        actions={<><Link to={`${workspace}/event-types/$id`} params={{ id: eventId }} className={buttonClassName("secondary")}>Back to event</Link><Button type="submit" disabled={!hydrated || saving || !timezone}>{saving ? "Saving…" : "Save recurring availability"}</Button></>}
      />
      {error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
      <Card className="p-5 sm:p-6">
        <SectionHeading icon="clock" title="Weekly windows" description={`Host timezone: ${timezone ?? "Loading…"}. Add one or more open windows per day.`} />
        <fieldset disabled={!hydrated || saving || !timezone} className="mt-6 grid gap-2.5 border-0 p-0">{days.map((day, weekday) => {
          const windows = eventType.availability.filter((window) => window.weekday === weekday);
          return <div key={day} className="rounded-2xl bg-row px-4 py-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{day}</h2><Button variant="secondary" type="button" onClick={() => update([...eventType.availability, { weekday, startMinute: 540, endMinute: 1020 }])}>Add window</Button></div>{windows.length === 0 ? <p className="mt-2"><Badge tone="warning">Unavailable</Badge></p> : <div className="mt-3 grid gap-2">{windows.map((window, index) => <div className="grid gap-2 sm:grid-cols-[10rem_10rem_auto]" key={index}><Input type="time" aria-label={`${day} window ${index + 1} start time`} required value={timeInput(window.startMinute)} onChange={(event) => update(replaceWindow(eventType.availability, weekday, index, { ...window, startMinute: timeMinutes(event.target.value) }))} /><Input type="time" aria-label={`${day} window ${index + 1} end time`} required value={timeInput(window.endMinute)} onChange={(event) => update(replaceWindow(eventType.availability, weekday, index, { ...window, endMinute: timeMinutes(event.target.value, true) }))} /><Button type="button" variant="quiet" aria-label={`Remove ${day} window ${index + 1}`} onClick={() => update(removeWindow(eventType.availability, weekday, index))}>Remove</Button></div>)}</div>}</div>;
        })}</fieldset>
      </Card>
      <p className="text-sm text-muted">An end time of 00:00 means midnight after this host date.</p>
    </form><ScheduleControls eventId={eventId} windows={eventType.availability} onApplied={setEventType} onCopyWindows={update} /><DateOverrideEditor eventId={eventId} timezone={timezone ?? undefined} /><BookingLimitFields eventId={eventId} /></div>
  );
}

function replaceWindow(all: AvailabilityWindowInput[], weekday: number, index: number, next: AvailabilityWindowInput) { let position = 0; return all.map((window) => window.weekday === weekday ? position++ === index ? next : window : window); }
function removeWindow(all: AvailabilityWindowInput[], weekday: number, index: number) { let position = 0; return all.filter((window) => window.weekday !== weekday || position++ !== index); }
