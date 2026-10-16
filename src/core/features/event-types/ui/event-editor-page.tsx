import { useWorkspaceRead } from "../../../app/workspace-reads";
import { ExtensionSlot } from "../../../app/extensions";
import { EventFields } from "./event-fields";
import { EventSharing } from "../../host-setup";
import { hostSetupChanged } from "../../host-setup";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import { EmptyState } from "../../../app/ui/empty-state";
import { QuestionsEditor } from "./questions-editor";
import { defaultEventTypeInput } from "../defaults";
import { ReadinessPanel } from "../../../app/ui/readiness-panel";
import { Badge, Button, Card, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import type { EventDetailsInput, EventTypeInput, EventTypeRecord } from "../repository";



export function EventEditorPage({ eventId, workspace = "/app" }: { eventId?: string; workspace?: "/app" | "/setup" }) {
  return <EventEditorForm key={eventId ?? "new"} eventId={eventId} workspace={workspace} />;
}
function EventEditorForm({ eventId, workspace = "/app" }: { eventId?: string; workspace?: "/app" | "/setup" }) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const loadEpoch = useRef(0);
  const slugEdited = useRef(false);
  const readinessEpoch = useRef(0);
  const navigate = useNavigate();
  const initialEvent = useWorkspaceRead<EventTypeRecord>(`/api/app/event-types/${eventId}`);
  const [eventType, setEventType] = useState<EventTypeInput | EventTypeRecord | undefined>(() => eventId ? initialEvent : defaultEventTypeInput());
  const [requestFailures, setRequestFailures] = useState<string[]>();
  type Readiness = { ready: boolean; missing: string[]; requests?: { ready: boolean; missing: string[] } };
  const initialReadiness = useWorkspaceRead<Readiness>(`/api/app/event-types/${eventId}/readiness`);
  const [readiness, setReadiness] = useState<Readiness | undefined>(initialReadiness);
  const [checking, setChecking] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const checkReadiness = useCallback(async () => {
    if (!eventId) return;
    const epoch = ++readinessEpoch.current; setChecking(true);
    try {
      const response = await api.api.app["event-types"][":id"].readiness.$get({ param: { id: eventId } });
      if (epoch !== readinessEpoch.current) return;
      if (!response.ok) { const message = await errorMessage(response); if (epoch === readinessEpoch.current) { setError(message); setReadiness(undefined); } return; }
      const current = await response.json();
      if (epoch === readinessEpoch.current) setReadiness(current);
    } catch { if (epoch === readinessEpoch.current) { setReadiness(undefined); setError("Publication readiness could not be checked. Publishing will check it again."); } }
    finally { if (epoch === readinessEpoch.current) setChecking(false); }
  }, [eventId]);
  const load = useCallback(async () => {
    if (!eventId) return;
    const epoch = ++loadEpoch.current; setError("");
    try {
      const response = await api.api.app["event-types"][":id"].$get({ param: { id: eventId } });
      if (epoch !== loadEpoch.current) return;
      if (!response.ok) { const message = await errorMessage(response); if (epoch === loadEpoch.current) setError(message); return; }
      const current = await response.json();
      if (epoch === loadEpoch.current) { setEventType(current); await checkReadiness(); }
    } catch { if (epoch === loadEpoch.current) setError("The event could not be loaded. Reload to try again."); }
  }, [eventId, checkReadiness]);
  useEffect(() => { void load(); return () => { loadEpoch.current += 1; readinessEpoch.current += 1; }; }, [load]);
  if (!eventType) return error ? <EmptyState tone="error" title="Event unavailable" description={error} action={<Button type="button" disabled={!hydrated} onClick={() => void load()}>Reload event</Button>} /> : <p role="status" className="text-sm text-muted">Loading event type…</p>;
  const currentEvent = eventType;
  const effectiveId = "id" in currentEvent ? currentEvent.id : eventId;

  function update<K extends keyof EventTypeInput>(key: K, value: EventTypeInput[K]) {
    setEventType((current) => current ? { ...current, [key]: value, ...(key === "title" && !effectiveId && !slugEdited.current ? { slug: String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) } : {}) } : current);
    if (key === "slug") slugEdited.current = true;
    readinessEpoch.current += 1; setChecking(false); setReadiness(undefined); setHasChanges(true);
  }

  function begin() {
    if (!hydrated || inFlight.current) return false;
    inFlight.current = true; readinessEpoch.current += 1; setChecking(false); setSaving(true); setError("");
    return true;
  }
  function finish() { inFlight.current = false; setSaving(false); }
  async function persist() {
    const { availability, alternativeRequestsEnabled, ...details } = currentEvent;
    const input: EventDetailsInput = details;
    const response = effectiveId
      ? await api.api.app["event-types"][":id"].details.$patch({ param: { id: effectiveId }, json: input })
      : await api.api.app["event-types"].$post({ json: { ...input, availability, alternativeRequestsEnabled } });
    if (!response.ok) { setError(await errorMessage(response)); return undefined; }
    const saved = await response.json(); setEventType(saved); setHasChanges(false); return saved;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!begin()) return;
    let saved: EventTypeRecord | undefined;
    try { saved = await persist(); if (saved) { if (effectiveId) await checkReadiness(); hostSetupChanged(); await navigate({ to: effectiveId ? `${workspace}/event-types/$id` : `${workspace}/event-types/$id/availability`, params: { id: saved.id } }); } }
    catch { setError(saved ? "Your event was saved. Return to the event list to open it again." : effectiveId ? "The save result could not be checked. Your details are kept here; retry to apply them." : "Creation could not be checked. Your details are kept; check the event list before creating another."); }
    finally { finish(); }
  }
  async function publish() {
    if (!effectiveId || !form.current?.reportValidity() || !begin()) return;
    try {
      if (hasChanges && !(await persist())) return;
      const response = await api.api.app["event-types"][":id"].publish.$post({ param: { id: effectiveId } });
      if (response.ok) { setEventType(await response.json()); setReadiness({ ready: true, missing: [] }); hostSetupChanged(); }
      else { const failure = await response.clone().json().catch(() => undefined) as { error?: { details?: string[] } } | undefined; setReadiness(failure?.error?.details ? { ready: false, missing: failure.error.details } : undefined); setError(await errorMessage(response)); }
    } catch { setError("Publication could not be checked. Your saved details are kept; retry publishing to check the current state."); }
    finally { finish(); }
  }
  async function openRequests() {
    if (!effectiveId || hasChanges) { setError("Save your changes before opening requests."); return; }
    if (!begin()) return;
    try {
      const response = await api.api.app["event-types"][":id"]["open-requests"].$post({ param: { id: effectiveId } });
      if (response.ok) { setEventType(await response.json()); setRequestFailures(undefined); hostSetupChanged(); }
      else { const failure = await response.clone().json().catch(() => undefined) as { error?: { details?: string[] } } | undefined; setRequestFailures(failure?.error?.details); setError(await errorMessage(response)); }
    } catch { setError("The result could not be received. Reload to check whether requests are open."); }
    finally { finish(); }
  }
  async function toggleRequests() {
    if (!effectiveId || !begin()) return;
    try {
      const response = await api.api.app["event-types"][":id"]["alternative-requests"].$patch({ param: { id: effectiveId }, json: { enabled: !eventType!.alternativeRequestsEnabled } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setEventType(await response.json()); hostSetupChanged(); await checkReadiness();
    } catch { setError("Request settings could not be saved. Reload the event to check its state."); }
    finally { finish(); }
  }
  async function disable() {
    if (!effectiveId || !begin()) return;
    try { const response = await api.api.app["event-types"][":id"].disable.$post({ param: { id: effectiveId } }); if (response.ok) { setEventType((current) => current ? { ...current, status: "disabled" } : current); hostSetupChanged(); await checkReadiness(); } else setError(await errorMessage(response)); }
    catch { setError("Disabling could not be checked. Retry to check the current state; your entered details are kept."); }
    finally { finish(); }
  }
  async function remove() {
    if (!effectiveId || inFlight.current || !window.confirm("Delete this event type? This removes its public availability and cannot be undone.") || !begin()) return;
    try { const response = await api.api.app["event-types"][":id"].$delete({ param: { id: effectiveId } }); if (response.ok || response.status === 404) await navigate({ to: `${workspace}/event-types` }); else setError(await errorMessage(response)); }
    catch { setError("Deletion could not be checked. Retry to check whether the event still exists."); }
    finally { finish(); }
  }

  const status = "status" in eventType ? eventType.status : "draft";
  return (
    <><form ref={form} className="grid gap-7" onSubmit={save}>
      <PageHeader eyebrow="Event type" title={eventType.title || "New event type"} description="Configure the guest-facing offer and the rules that govern its availability." actions={<><Link to={`${workspace}/event-types`} className={buttonClassName("secondary")}>Back to event types</Link><Button type="submit" disabled={!hydrated || saving}>{saving ? "Saving…" : "Save changes"}</Button></>} />
      {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
      <fieldset disabled={!hydrated || saving} className="grid gap-6 border-0 p-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <EventFields event={eventType} update={update} />
          <QuestionsEditor questions={eventType.questions} onChange={(questions) => update("questions", questions)} />
        </div>
        <aside className="grid content-start gap-5">{effectiveId ? <EventSharing workspace={workspace} eventId={effectiveId} /> : null}<ReadinessPanel workspace={workspace} eventId={effectiveId} missing={readiness?.missing} checking={checking} notice={!effectiveId ? "Save the event before checking publication readiness." : hasChanges ? "Publication checks your saved changes." : undefined} /><Card className="p-5 sm:p-6"><SectionHeading icon="clock" title="Availability" /><p className="mt-3 text-sm leading-6 text-soft">{eventType.availability.length === 0 ? "No recurring availability is configured." : `${eventType.availability.length} recurring window${eventType.availability.length === 1 ? "" : "s"} configured.`}</p>{effectiveId ? <Link className={buttonClassName("quiet", "mt-2")} to={`${workspace}/event-types/$id/availability`} params={{ id: effectiveId }}>Edit recurring availability →</Link> : <p className="mt-4 text-sm text-muted">Save this event type before adding availability.</p>}</Card><Card className="p-5 sm:p-6"><SectionHeading icon="restore" title="Lifecycle" action={<Badge tone={status === "draft" ? "warning" : status === "disabled" ? "danger" : "success"}>{"requestOnly" in eventType && eventType.requestOnly && status === "published" ? "Requests only" : status}</Badge>} /><p className="mt-3 text-sm leading-6 text-soft">Publishing turns on real bookings using your saved availability and existing Dial bookings. Without a connected calendar, Dial does not check external calendar conflicts. A connected calendar must pass its checks. Disabled event types are no longer public.</p>{effectiveId ? <div className="mt-4 grid gap-2.5"><Button type="button" variant="secondary" disabled={saving || hasChanges} onClick={() => void toggleRequests()}>{eventType.alternativeRequestsEnabled ? "Disable alternative requests" : "Enable alternative requests"}</Button>{status !== "published" ? <>{(requestFailures ?? readiness?.requests?.missing)?.length ? <ReadinessPanel workspace={workspace} eventId={effectiveId} missing={requestFailures ?? readiness?.requests?.missing} notice="Complete these steps to Open requests." /> : null}<p className="text-sm leading-6 text-soft">Open requests lets guests propose times before automatic booking is ready. It requires a saved host profile, alternative requests enabled, and a verified mail sender. No automatic bookings are offered.</p><Button type="button" variant="secondary" disabled={!hydrated || saving || checking || hasChanges || readiness?.requests?.ready !== true} onClick={() => void openRequests()}>Open requests</Button></> : null}<Button type="button" variant="secondary" disabled={!hydrated || saving || checking || hasChanges || readiness?.ready !== true} onClick={() => void publish()}>{status === "published" ? "Update published event" : "Publish event type"}</Button>{status !== "disabled" ? <Button type="button" variant="secondary" onClick={() => void disable()}>Disable event type</Button> : null}<Button type="button" variant="danger" onClick={() => void remove()}>Delete event type</Button></div> : null}</Card></aside>
      </fieldset>
    </form>
    {effectiveId ? <ExtensionSlot id="event-type.settings.after.v1" entityId={effectiveId} /> : null}</>
  );
}
