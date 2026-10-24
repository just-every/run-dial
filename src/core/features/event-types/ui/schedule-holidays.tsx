import { useState } from "react";
import { Button, Input } from "../../../app/ui/primitives";
import { scheduleInputSchema, type ScheduleInput } from "../../availability";
import { usFederalHolidays } from "../../availability";

type Closures = Pick<ScheduleInput, "blockUsHolidays" | "reopenedHolidays" | "timeOff">;

export function ScheduleHolidays({ value, onChange }: { value: Closures; onChange(next: Partial<Closures>): void }) {
  const [year] = useState(() => new Date().getFullYear());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");

  function addTimeOff() {
    const range = { startDate, endDate: endDate || startDate };
    const result = scheduleInputSchema.shape.timeOff.safeParse([...value.timeOff, range]);
    if (!result.success) { setError("Choose real dates, with the last date on or after the first. A schedule can have up to 100 time-off ranges."); return; }
    if (value.timeOff.some(entry => entry.startDate === range.startDate && entry.endDate === range.endDate)) { setError("This time-off range is already included."); return; }
    onChange({ timeOff: result.data.sort((left, right) => left.startDate.localeCompare(right.startDate)) });
    setStartDate(""); setEndDate(""); setError("");
  }

  return <div className="grid min-w-0 gap-6">
    <div>
      <h3 className="font-bold">US holidays</h3>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={value.blockUsHolidays} onChange={event => onChange({ blockUsHolidays: event.target.checked })} />
        Block US federal holidays and observed dates
      </label>
      <p className="mt-1 text-sm leading-6 text-muted">Holiday rules repeat every year. When blocking is enabled, check an individual date to reopen it using the weekly windows. Time off still closes that date.</p>
      <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Review holidays and reopen individual dates</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{[year, year + 1].map(holidayYear => <fieldset key={holidayYear} disabled={!value.blockUsHolidays} className="min-w-0 rounded-2xl bg-row p-4">
        <legend className="px-1 text-sm font-bold">{holidayYear}</legend>
        <div className="grid gap-1">{usFederalHolidays(holidayYear).map(holiday => <label key={`${holiday.date}-${holiday.name}`} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-ink" checked={value.reopenedHolidays.includes(holiday.date)} onChange={event => onChange({ reopenedHolidays: event.target.checked ? [...value.reopenedHolidays, holiday.date] : value.reopenedHolidays.filter(date => date !== holiday.date) })} />
          <span className="min-w-0"><span className="block font-semibold">Reopen {holiday.name}</span><span className="text-muted">{dateLabel(holiday.date)}</span></span>
        </label>)}</div>
      </fieldset>)}</div></details>
    </div>
    <div>
      <h3 className="font-bold">Time off</h3>
      <p className="mt-1 text-sm leading-6 text-muted">Close every day in a range, including both dates, in the host timezone, on every event.</p>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid min-w-0 gap-2 text-sm font-semibold">First date<Input type="date" className="min-w-0" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label className="grid min-w-0 gap-2 text-sm font-semibold">Last date (optional)<Input type="date" className="min-w-0" min={startDate || undefined} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <Button type="button" variant="secondary" onClick={addTimeOff}>Add time off</Button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {value.timeOff.length === 0 ? <p className="mt-3 text-sm text-muted">No time off added.</p> : <ul className="mt-3 grid gap-2">{value.timeOff.map((range, index) => <li key={`${range.startDate}-${range.endDate}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-row px-4 py-2">
        <span className="text-sm">{dateLabel(range.startDate)}{range.endDate !== range.startDate ? ` – ${dateLabel(range.endDate)}` : ""}</span>
        <Button type="button" variant="quiet" aria-label={`Remove time off ${range.startDate} through ${range.endDate}`} onClick={() => onChange({ timeOff: value.timeOff.filter((_, position) => position !== index) })}>Remove</Button>
      </li>)}</ul>}
    </div>
  </div>;
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
