import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { SectionHeading } from "../../../app/ui/page-header";
import { Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import { scheduleInputSchema, type NamedSchedule, type ScheduleInput } from "../../availability";
import type { AvailabilityWindowInput, EventTypeRecord } from "../repository";
import { ScheduleHolidays } from "./schedule-holidays";

type Props = {
  eventId: string;
  windows: AvailabilityWindowInput[];
  onApplied(event: EventTypeRecord): void;
  onCopyWindows?(windows: AvailabilityWindowInput[]): void;
};
const emptyDraft = (): ScheduleInput => ({ name: "", windows: [], blockUsHolidays: false, reopenedHolidays: [], timeOff: [] });

/** Render beside the weekly-hours form, never inside it. */
export function ScheduleControls({ eventId, windows, onApplied, onCopyWindows }: Props) {
  const hydrated = useHydrated();
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const [schedules, setSchedules] = useState<NamedSchedule[]>();
  const [events, setEvents] = useState<EventTypeRecord[]>([]);
  const [boundId, setBoundId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [copyEventId, setCopyEventId] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = ++epoch.current;
    setError(""); setSchedules(undefined);
    try {
      const responses = await Promise.all([
        api.api.app["availability-schedules"].$get(),
        api.api.app["event-types"][":id"].schedule.$get({ param: { id: eventId } }),
        api.api.app["event-types"].$get(),
      ]);
      const failed = responses.find(response => !response.ok);
      if (failed) throw new Error(await errorMessage(failed));
      const [list, binding, eventList] = await Promise.all(responses.map(response => response.json())) as [NamedSchedule[], { schedule: NamedSchedule | null }, EventTypeRecord[]];
      if (token !== epoch.current) return;
      setSchedules(list); setEvents(eventList); setBoundId(binding.schedule?.id ?? null);
      setSelectedId(binding.schedule?.id ?? ""); setDraftId(binding.schedule?.id ?? null);
      setDraft(binding.schedule ? toInput(binding.schedule) : emptyDraft());
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : "Schedules could not be loaded. Reload to try again."); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { epoch.current += 1; }; }, [load]);

  const disabled = !hydrated || saving || !schedules;
  const bound = schedules?.find(schedule => schedule.id === boundId);
  const selected = schedules?.find(schedule => schedule.id === selectedId);
  const editing = schedules?.find(schedule => schedule.id === draftId);

  function changeDraft(next: Partial<ScheduleInput>) { setDraft(current => ({ ...current, ...next })); setStatus(""); }
  function storeSchedule(schedule: NamedSchedule) {
    setSchedules(current => [...(current ?? []).filter(entry => entry.id !== schedule.id), schedule].sort((left, right) => left.name.localeCompare(right.name)));
    setDraftId(schedule.id); setDraft(toInput(schedule));
  }
  async function bind(scheduleId: string | null) {
    const response = await api.api.app["event-types"][":id"].schedule.$put({ param: { id: eventId }, json: { scheduleId } });
    if (!response.ok) throw new Error(await errorMessage(response));
    const event = await response.json();
    setSchedules(current => current?.map(schedule => ({ ...schedule, eventCount: schedule.eventCount + (schedule.id === scheduleId && boundId !== scheduleId ? 1 : 0) - (schedule.id === boundId && boundId !== scheduleId ? 1 : 0) })));
    setBoundId(scheduleId); setSelectedId(scheduleId ?? "");
    onApplied(event);
  }
  async function apply() {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(""); setStatus("");
    try {
      await bind(selectedId || null);
      setDraftId(selected?.id ?? null); setDraft(selected ? toInput(selected) : emptyDraft());
      setStatus(selected ? `“${selected.name}” applied. Its weekly windows, holidays and time off now apply to this event.` : "This event now keeps independent hours. Its saved weekly windows are unchanged; schedule holidays and time off no longer apply.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The schedule change could not be checked. Reload before trying again."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function copyEventHours() {
    if (disabled || inFlight.current || !onCopyWindows || !copyEventId) return;
    inFlight.current = true; setSaving(true); setError(""); setStatus("");
    try {
      const response = await api.api.app["event-types"].$get();
      if (!response.ok) throw new Error(await errorMessage(response));
      const latest = await response.json();
      setEvents(latest);
      const source = latest.find(event => event.id === copyEventId);
      if (!source) throw new Error("The selected event type is no longer available. Choose another event.");
      onCopyWindows(source.availability.map(window => ({ ...window })));
      setStatus(`Weekly windows copied from “${source.title}”. Save to apply your edited hours.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The event’s hours could not be loaded. Try copying again."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    const parsed = scheduleInputSchema.safeParse({ ...draft, windows });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.path[0] === "windows" ? `Weekly windows: ${issue.message}` : issue.message).join(" ")); return; }
    inFlight.current = true; setSaving(true); setError(""); setStatus("");
    let stored: NamedSchedule | undefined;
    try {
      const response = draftId
        ? await api.api.app["availability-schedules"][":id"].$put({ param: { id: draftId }, json: parsed.data })
        : await api.api.app["availability-schedules"].$post({ json: parsed.data });
      if (!response.ok) throw new Error(await errorMessage(response));
      stored = await response.json(); storeSchedule(stored);
      await bind(stored.id);
      setStatus(`“${stored.name}” saved and applied. ${Math.max(1, stored.eventCount + (boundId !== stored.id ? 1 : 0))} event type${Math.max(1, stored.eventCount + (boundId !== stored.id ? 1 : 0)) === 1 ? " uses" : "s use"} these hours and closures.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The save result could not be checked.";
      setError(stored ? `“${stored.name}” was saved, but applying it to this event could not be checked. ${message} Reload to review the current binding.` : `${message} Your edits are kept here.`);
    } finally { inFlight.current = false; setSaving(false); }
  }

  return <Card className="min-w-0 p-5 sm:p-6">
    <SectionHeading icon="clock" title="Named schedules" description="Reuse weekly hours, holidays and time off across event types, or keep this event’s hours independent. Schedule time off and blocked holidays take priority over date-specific overrides." />
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    {status ? <p role="status" className={noticeClassName("success", "mt-4")}>{status}</p> : null}
    {!schedules ? error ? <Button className="mt-4" type="button" variant="secondary" disabled={!hydrated || saving} onClick={() => void load()}>Reload schedules</Button> : <p role="status" className="mt-4 text-sm text-muted">Loading schedules…</p> : <>
      <fieldset disabled={disabled} className="mt-5 grid min-w-0 gap-4 border-0 p-0">
        <p className="text-sm leading-6 text-soft">{bound ? `Current schedule: ${bound.name}. Shared by ${bound.eventCount} event type${bound.eventCount === 1 ? "" : "s"}.` : "This event currently uses independent hours."}</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid min-w-0 gap-2 text-sm font-semibold">Schedule<Select value={selectedId} onChange={event => { setSelectedId(event.target.value); setStatus(""); }}><option value="">Keep independent hours</option>{schedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name} ({schedule.eventCount} event types)</option>)}</Select></label>
          <Button type="button" variant="secondary" onClick={() => void apply()} disabled={selectedId === (boundId ?? "")}>{saving ? "Applying…" : selectedId ? "Apply schedule" : "Use independent hours"}</Button>
        </div>
        {selected && selectedId !== boundId ? <p className="text-sm leading-6 text-muted">Applying “{selected.name}” replaces this event’s weekly hours and closures. It is currently used by {selected.eventCount} event type{selected.eventCount === 1 ? "" : "s"}.</p> : null}
        {onCopyWindows ? <div className="grid gap-3 border-t border-line-soft pt-4">
          <p className="text-sm leading-6 text-muted">Copy weekly windows into the editor above, then save recurring availability or a named schedule to apply them. Holidays and time off are not copied.</p>
          {selected ? <Button type="button" variant="secondary" className="w-fit" onClick={() => { onCopyWindows(selected.windows.map(window => ({ ...window }))); setStatus(`Weekly windows copied from “${selected.name}”. Save to apply your edited hours.`); }}>Copy selected schedule’s hours</Button> : null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-2 text-sm font-semibold">Copy hours from another event<Select value={copyEventId} onChange={event => setCopyEventId(event.target.value)}><option value="">Choose an event type</option>{events.filter(event => event.id !== eventId).map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</Select></label>
            <Button type="button" variant="secondary" disabled={!copyEventId} onClick={() => void copyEventHours()}>Copy event hours</Button>
          </div>
        </div> : null}
      </fieldset>
      <form className="mt-6 border-t border-line-soft pt-5" onSubmit={event => void save(event)}>
        <fieldset disabled={disabled} className="grid min-w-0 gap-5 border-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{draftId ? "Edit shared schedule" : "Create a named schedule"}</h3>{draftId ? <Button type="button" variant="quiet" onClick={() => { setDraftId(null); setDraft(emptyDraft()); setStatus(""); }}>Create a new schedule instead</Button> : bound ? <Button type="button" variant="quiet" onClick={() => { setDraftId(bound.id); setDraft(toInput(bound)); setStatus(""); }}>Edit current schedule</Button> : null}</div>
          <label className="grid min-w-0 gap-2 text-sm font-semibold">Schedule name<Input required maxLength={120} value={draft.name} onChange={event => changeDraft({ name: event.target.value })} /></label>
          <p className="rounded-2xl bg-row px-4 py-3 text-sm leading-6 text-soft">{editing ? `Saving updates all ${editing.eventCount} event type${editing.eventCount === 1 ? "" : "s"} using “${editing.name}” and applies it to this event. ` : "Saving creates a schedule and applies it to this event. "}The {windows.length} weekly window{windows.length === 1 ? "" : "s"} currently shown in the editor above will be saved with these holidays and time off.</p>
          <ScheduleHolidays key={`${eventId}-${draftId ?? "new"}`} value={draft} onChange={changeDraft} />
          <Button type="submit" className="w-fit">{saving ? "Saving…" : draftId ? "Save shared schedule" : "Create and apply schedule"}</Button>
        </fieldset>
      </form>
    </>}
  </Card>;
}

function toInput(schedule: NamedSchedule): ScheduleInput {
  return { name: schedule.name, windows: schedule.windows, blockUsHolidays: schedule.blockUsHolidays, reopenedHolidays: schedule.reopenedHolidays, timeOff: schedule.timeOff };
}
