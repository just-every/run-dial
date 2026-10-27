import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { useAutosave, type FieldState } from "../../../app/ui/autosave/use-autosave";
import { Button, Input } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import type { AvailabilityWindowInput } from "../../event-types";
import { scheduleInputSchema } from "../schedule-input";
import { usFederalHolidays } from "../us-holidays";
import type { Closures, HoursRead } from "../your-hours";
import { WeeklyHours } from "./weekly-hours";

type TimeOffProps = { value: Closures; state: FieldState; onChange(next: Closures["timeOff"]): void; onRetry(): void };
export function TimeOff({ value, state, onChange, onRetry }: TimeOffProps) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");
  function add(event: React.FormEvent) {
    event.preventDefault();
    const range = { startDate: first, endDate: last || first };
    const parsed = scheduleInputSchema.shape.timeOff.safeParse([...value.timeOff, range]);
    if (!parsed.success) { setError("Choose real dates, with the last on or after the first."); return; }
    if (value.timeOff.some(entry => entry.startDate === range.startDate && entry.endDate === range.endDate)) { setError("Those days are already included."); return; }
    onChange(parsed.data.sort((left, right) => left.startDate.localeCompare(right.startDate)));
    setFirst(""); setLast(""); setError("");
  }
  return <div className="grid gap-3">
    <form onSubmit={add} className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
      <label className="grid min-w-0 gap-1.5 text-sm font-semibold"><span className="flex items-center justify-between gap-2">First date<SavedMark state={state} /></span><Input type="date" aria-label="First date" required className="min-w-0" value={first} onChange={event => setFirst(event.target.value)} /></label>
      <label className="grid min-w-0 gap-1.5 text-sm font-semibold"><span>Last date (optional)</span><Input type="date" aria-label="Last date (optional)" className="min-w-0" min={first || undefined} value={last} onChange={event => setLast(event.target.value)} /></label>
      <Button type="submit" variant="secondary" className="sm:mt-[26px]">Add time off</Button>
    </form>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <SaveFailed id="time-off-failure" state={state} what="time off" choice onRetry={onRetry} />
    {value.timeOff.length ? <ul className="grid gap-2">{value.timeOff.map((range, index) => <li key={`${range.startDate}-${range.endDate}`} aria-label={`${shortDate(range.startDate)} through ${shortDate(range.endDate)}`} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-row px-3 py-2">
      <span className="min-w-0 text-sm">{shortDate(range.startDate)}{range.endDate !== range.startDate ? `–${shortDate(range.endDate)}` : ""}</span>
      <Tooltip label="Remove time off"><button type="button" className="grid size-11 shrink-0 place-items-center rounded-full bg-wash text-xl text-ink hover:bg-gold-wash focus-visible:outline-2 focus-visible:outline-ink" onClick={() => onChange(value.timeOff.filter((_, position) => position !== index))}><span aria-hidden="true">×</span></button></Tooltip>
    </li>)}</ul> : null}
  </div>;
}

/** This list lives inside the holiday row; the row's switch belongs to the parent. */
export function Holidays({ value, state, onChange, onRetry }: { value: Closures; state: FieldState; onChange(next: Partial<Closures>): void; onRetry(): void }) {
  const [year] = useState(() => new Date().getFullYear());
  return <div className="grid gap-3">
    <div className="flex items-center justify-between gap-2 text-sm text-muted"><span>Reopen a date to use your weekly hours.</span><SavedMark state={state} /></div>
    <SaveFailed id="reopened-holidays-failure" state={state} what="holiday dates" choice onRetry={onRetry} />
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">{[year, year + 1].map(holidayYear => <fieldset key={holidayYear} disabled={!value.blockUsHolidays} className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-bold">{holidayYear}</legend>
      {usFederalHolidays(holidayYear).map(holiday => <label key={`${holiday.date}-${holiday.name}`} className="relative flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-wash">
        <input type="checkbox" className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 peer" checked={value.reopenedHolidays.includes(holiday.date)} onChange={event => onChange({ reopenedHolidays: event.target.checked ? [...value.reopenedHolidays, holiday.date] : value.reopenedHolidays.filter(date => date !== holiday.date) })} />
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded border border-line bg-field text-[13px] text-ink peer-checked:bg-gold-wash peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">{value.reopenedHolidays.includes(holiday.date) ? "✓" : ""}</span>
        <span className="min-w-0"><span className="block font-semibold">Reopen {holiday.name}</span><span className="text-muted">{shortDate(holiday.date)}</span></span>
      </label>)}
    </fieldset>)}</div>
  </div>;
}

export function OtherHours({ initial, windows }: { initial: HoursRead["others"]; windows: AvailabilityWindowInput[] }) {
  const [others, setOthers] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [addedId, setAddedId] = useState("");
  return <div className="grid gap-4">
    {others.map(schedule => <OtherHoursEditor key={schedule.id} initial={schedule} open={addedId === schedule.id} />)}
    {adding ? <NewOtherHours windows={windows} onAdded={schedule => { setOthers(current => [...current, schedule]); setAddedId(schedule.id); setAdding(false); }} onCancel={() => setAdding(false)} /> : <Button type="button" variant="secondary" onClick={() => setAdding(true)}>Add other hours</Button>}
  </div>;
}

function OtherHoursEditor({ initial, open }: { initial: HoursRead["others"][number]; open: boolean }) {
  const form = useAutosave(`other-hours:${initial.id}`, { name: initial.name, windows: initial.windows }, async (next, init) => {
    if (next.windows.some(window => window.endMinute <= window.startMinute)) throw new Error("Ends before it starts. Choose a later end time.");
    const response = await api.api.app["availability-schedules"][":id"].$put({ param: { id: initial.id }, json: { ...next, blockUsHolidays: false, reopenedHolidays: [], timeOff: [] } }, { init });
    if (!response.ok) throw new Error(await errorMessage(response));
  });
  return <details className="min-w-0" open={open}>
    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">{form.values.name || initial.name}</summary>
    <div className="grid gap-4 pt-2">
      <label className="grid gap-1.5 text-sm font-semibold"><span className="flex flex-wrap items-center justify-between gap-2">Name<SavedMark state={form.state("name")} /></span><Input aria-label={`Name for ${initial.name}`} maxLength={120} value={form.values.name} aria-describedby={form.state("name").failed ? `${initial.id}-name-failure` : undefined} onChange={event => form.type("name", event.target.value)} onBlur={form.leave} /></label>
      <SaveFailed id={`${initial.id}-name-failure`} state={form.state("name")} what="hours name" onRetry={form.retry} />
      <div className="flex items-center justify-between gap-2 text-sm font-semibold">Weekly hours<SavedMark state={form.state("windows")} /></div>
      <WeeklyHours label={`${initial.name} weekly hours`} windows={form.values.windows} onChange={next => form.choose("windows", next)} />
      <SaveFailed id={`${initial.id}-windows-failure`} state={form.state("windows")} what="hours" choice onRetry={form.retry} />
    </div>
  </details>;
}

function NewOtherHours({ windows, onAdded, onCancel }: { windows: AvailabilityWindowInput[]; onAdded(schedule: HoursRead["others"][number]): void; onCancel(): void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creationForm = useRef<HTMLFormElement>(null);
  useEffect(() => { creationForm.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  async function add(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || !name.trim()) { creationForm.current?.querySelector<HTMLInputElement>("input")?.focus(); return; }
    setBusy(true); setError("");
    try {
      const response = await api.api.app["availability-schedules"].$post({ json: { name, windows, blockUsHolidays: false, reopenedHolidays: [], timeOff: [] } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const schedule = await response.json();
      onAdded({ id: schedule.id, name: schedule.name, windows: schedule.windows, eventIds: [] });
    } catch { setError("Couldn’t add these hours. Your name is kept here."); }
    finally { setBusy(false); }
  }
  return <form ref={creationForm} onSubmit={event => void add(event)} className="grid gap-3">
    <label className="grid gap-1.5 text-sm font-semibold">Hours name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    {error ? <p role="alert" className="text-sm text-danger">{error} <button type="button" className="min-h-11 font-semibold underline" onClick={() => void add()}>Retry</button></p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Add hours</Button><Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function shortDate(date: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
