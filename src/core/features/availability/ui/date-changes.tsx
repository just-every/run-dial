import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SaveFailed, SavedMark } from "../../../app/ui/autosave/saved-state";
import { Button, Input, Select } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import type { DateAvailabilityOverrideRecord, DateAvailabilityWindowInput } from "../../event-types";
import { timeInput, timeMinutes } from "./window-time";

type DateHours = { mode: "open" | "closed"; windows: DateAvailabilityWindowInput[] };
const defaultWindow = () => ({ startMinute: 540, endMinute: 1020 });
const shortDate = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** Date exceptions belong to this event; weekly hours, holidays and time off keep their own homes. */
export function DateChanges({ eventId }: { eventId: string; timezone?: string }) {
  return <EventDateChanges key={eventId} eventId={eventId} />;
}

function EventDateChanges({ eventId }: { eventId: string }) {
  const [records, setRecords] = useState<DateAvailabilityOverrideRecord[]>();
  const [error, setError] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const loadEpoch = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    setError(false);
    try {
      const response = await api.api.app["event-types"][":id"]["availability-overrides"].$get({ param: { id: eventId } });
      if (!response.ok) throw new Error();
      const records = await response.json();
      if (epoch === loadEpoch.current) setRecords(records);
    } catch { if (epoch === loadEpoch.current) setError(true); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { loadEpoch.current += 1; }; }, [load]);

  return <div className="grid gap-4">
    {records ? <>{records.length ? records.map(record => <DateChange key={record.id} eventId={eventId} record={record} onRemoved={() => {
      setRecords(current => current?.filter(entry => entry.id !== record.id));
      addButton.current?.focus();
    }} />) : <p className="text-sm text-muted">No dates changed.</p>}
      <AddDate eventId={eventId} existingDates={records.map(record => record.hostDate)} buttonRef={addButton} onAdded={record => setRecords(current => [...(current ?? []), record].sort((a, b) => a.hostDate.localeCompare(b.hostDate)))} />
    </> : error ? <p role="alert" className="text-sm text-danger">Dates couldn’t be loaded. <Button type="button" variant="quiet" onClick={() => void load()}>Retry</Button></p> : <p role="status" className="text-sm text-muted">Loading dates…</p>}
  </div>;
}

function DateChange({ eventId, record, onRemoved }: { eventId: string; record: DateAvailabilityOverrideRecord; onRemoved(): void }) {
  const form = useAutosave(`date-hours:${record.id}`, { hours: { mode: record.mode, windows: record.windows } as DateHours, removed: false }, async (next, init) => {
    const endpoint = api.api.app["event-types"][":id"]["availability-overrides"][":hostDate"];
    const param = { id: eventId, hostDate: record.hostDate };
    const response = next.removed ? await endpoint.$delete({ param }, { init }) : await endpoint.$put({ param, json: next.hours }, { init });
    if (!response.ok && !(next.removed && response.status === 404)) throw new Error(await errorMessage(response));
    if (next.removed) onRemoved();
  });
  const id = `date-${record.id}`;
  return <div className="grid gap-3 rounded-2xl bg-row p-4" role="group" aria-label={`Hours on ${shortDate(record.hostDate)}`}>
    <div className="flex items-center justify-between gap-3"><h3 className="flex flex-wrap items-center gap-3 font-semibold">{shortDate(record.hostDate)}<SavedMark state={form.state("hours")} /></h3>
      <Tooltip label="Remove date"><Button variant="quiet" type="button" className="min-w-11 no-underline" onClick={() => form.choose("removed", true)}>×</Button></Tooltip>
    </div>
    <DateHoursFields label={shortDate(record.hostDate)} value={form.values.hours} onChange={hours => form.choose("hours", hours)} />
    <SaveFailed id={`${id}-hours-error`} state={form.state("hours")} what="this date" choice onRetry={form.retry} />
    <SaveFailed id={`${id}-remove-error`} state={form.state("removed")} what="the removal" choice onRetry={form.retry} />
  </div>;
}

function AddDate({ eventId, existingDates, buttonRef, onAdded }: { eventId: string; existingDates: string[]; buttonRef: React.RefObject<HTMLButtonElement | null>; onAdded(record: DateAvailabilityOverrideRecord): void }) {
  const [open, setOpen] = useState(false);
  const [hostDate, setHostDate] = useState("");
  const [hours, setHours] = useState<DateHours>({ mode: "closed", windows: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const adding = useRef(false);
  const restoreFocus = useRef(false);
  async function add() {
    if (!hostDate || adding.current) return;
    if (existingDates.includes(hostDate)) { setError("This date is already listed. Change its hours above."); return; }
    adding.current = true; setBusy(true); setError("");
    try {
      const response = await api.api.app["event-types"][":id"]["availability-overrides"][":hostDate"].$put({ param: { id: eventId, hostDate }, json: hours });
      if (!response.ok) throw new Error(await errorMessage(response));
      onAdded(await response.json()); setHostDate(""); setHours({ mode: "closed", windows: [] }); restoreFocus.current = true; setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Your date and hours are kept here."); }
    finally { adding.current = false; setBusy(false); }
  }
  useEffect(() => { if (!open && restoreFocus.current) { buttonRef.current?.focus(); restoreFocus.current = false; } }, [open]);
  if (!open) return <div><Button ref={buttonRef} type="button" variant="secondary" onClick={() => setOpen(true)}>Add date</Button></div>;
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void add(); }}>
    <label className="grid gap-2 text-sm font-semibold">Host date<Input type="date" value={hostDate} required onChange={event => setHostDate(event.target.value)} /></label>
    <DateHoursFields label="New date" value={hours} onChange={setHours} />
    <div className="flex flex-wrap gap-3"><Button type="submit" variant="secondary" disabled={busy}>Add date</Button><Button type="button" variant="quiet" onClick={() => { restoreFocus.current = true; setOpen(false); }}>Cancel</Button></div>
    {error ? <p role="alert" className="text-sm text-danger">Couldn’t add this date. {error} <Button type="button" variant="quiet" onClick={() => void add()}>Retry</Button></p> : null}
  </form>;
}

function DateHoursFields({ label, value, onChange }: { label: string; value: DateHours; onChange(next: DateHours): void }) {
  return <div className="grid gap-3">
    <label className="grid gap-2 text-sm font-semibold">Schedule for this date<Select value={value.mode} onChange={event => onChange(event.target.value === "closed" ? { mode: "closed", windows: [] } : { mode: "open", windows: value.windows.length ? value.windows : [defaultWindow()] })}><option value="closed">Closed all day</option><option value="open">Open at these times</option></Select></label>
    {value.mode === "open" ? <div className="grid gap-2">
      {value.windows.map((window, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_44px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]">
        <Input type="time" aria-label={`${label} window ${index + 1} start time`} value={timeInput(window.startMinute)} onChange={event => { const startMinute = timeMinutes(event.target.value); if (Number.isFinite(startMinute)) onChange({ ...value, windows: value.windows.map((entry, position) => position === index ? { ...entry, startMinute } : entry) }); }} />
        <Input type="time" className="col-start-1 sm:col-start-auto" aria-label={`${label} window ${index + 1} end time`} value={timeInput(window.endMinute)} onChange={event => { const endMinute = timeMinutes(event.target.value, true); if (Number.isFinite(endMinute)) onChange({ ...value, windows: value.windows.map((entry, position) => position === index ? { ...entry, endMinute } : entry) }); }} />
        <Tooltip label="Remove hours"><Button variant="quiet" type="button" className="col-start-2 row-start-1 min-w-11 no-underline sm:col-start-3" onClick={() => { const windows = value.windows.filter((_, position) => position !== index); onChange({ mode: windows.length ? "open" : "closed", windows }); }}>×</Button></Tooltip>
      </div>)}
      <div><Button type="button" variant="quiet" onClick={() => onChange({ ...value, windows: [...value.windows, defaultWindow()] })}>Add hours</Button></div>
    </div> : null}
  </div>;
}
