import { useState } from "react";
import { Button, Input, Select } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import type { AvailabilityWindowInput } from "../repository";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const time = (minute: number) => minute < 0 || !Number.isFinite(minute) ? "" : `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) => { if (!value) return -1; const [hour, minutes] = value.split(":").map(Number); return hour * 60 + minutes; };
export function hoursSummary(windows: AvailabilityWindowInput[]) {
  if (!windows.length) return "No hours set";
  const groups = new Map<string, number[]>();
  for (const window of windows) { const label = `${time(window.startMinute)}–${time(window.endMinute)}`; groups.set(label, [...(groups.get(label) ?? []), window.weekday]); }
  return [...groups].map(([label, weekdays]) => {
    const sorted = weekdays.sort((a, b) => (a || 7) - (b || 7));
    const consecutive = sorted.every((day, index) => index === 0 || (day || 7) === (sorted[index - 1] || 7) + 1);
    return `${sorted.length > 2 && consecutive ? `${days[sorted[0]]}–${days[sorted.at(-1)!]}` : sorted.map(day => days[day]).join(", ")} ${label}`;
  }).join(" · ");
}
export function StepWhen({ uses, windows, yours, loading, error, onRetry, onUses, onWindows }: { uses: "yours" | "own"; windows: AvailabilityWindowInput[]; yours?: AvailabilityWindowInput[]; loading: boolean; error: string; onRetry(): void; onUses(value: "yours" | "own"): void; onWindows(value: AvailabilityWindowInput[]): void }) {
  const [day, setDay] = useState(1);
  function change(index: number, patch: Partial<AvailabilityWindowInput>) { onWindows(windows.map((window, position) => position === index ? { ...window, ...patch } : window)); }
  return <div className="grid min-w-0 gap-4">
    <div className="grid grid-cols-2 items-start gap-3" role="radiogroup" aria-label="Hours">{([['yours', 'Your hours'], ['own', 'Its own hours']] as const).map(([value, title]) => <label key={value} className={`flex min-h-16 cursor-pointer items-center gap-2 rounded-[18px] p-3 ${uses === value ? "bg-gold-wash" : "bg-wash"}`}><input type="radio" name="hours" value={value} checked={uses === value} onChange={() => onUses(value)} /><span className="min-w-0"><span className="block text-[15px] font-semibold">{title}</span><span className="block text-sm text-soft">{value === "yours" ? yours ? hoursSummary(yours) : loading ? "Reading your hours…" : "Your hours could not be read" : "Weekly times"}</span></span></label>)}</div>
    {error ? <p role="alert" className="text-sm text-danger">{error} <Button type="button" variant="quiet" onClick={onRetry}>Retry</Button></p> : null}
    {uses === "own" && yours ? <div className="grid min-w-0 gap-2" aria-label="Weekly hours">
      <div className="flex items-start gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">Day<Select aria-label="Day" value={day} onChange={event => setDay(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 0].map(value => <option key={value} value={value}>{days[value]}</option>)}</Select></label><Tooltip label={`Add ${days[day]} hours`}><Button type="button" variant="secondary" className="h-11 w-11 shrink-0 !p-0" onClick={() => onWindows([...windows, { weekday: day, startMinute: 540, endMinute: 1020 }])}>+</Button></Tooltip></div>
      <div className="grid max-h-28 min-w-0 gap-2 overflow-y-auto p-1 -m-1">{windows.map((window, index) => window.weekday === day ? <div key={index} className="flex min-w-0 items-start gap-2"><label className="min-w-0 flex-1"><span className="sr-only">{days[day]} start {index + 1}</span><Input className="min-w-0" type="time" required value={time(window.startMinute)} onChange={event => change(index, { startMinute: minute(event.target.value) })} /></label><label className="min-w-0 flex-1"><span className="sr-only">{days[day]} end {index + 1}</span><Input className="min-w-0" type="time" required min={window.endMinute === 1440 || window.startMinute < 0 ? undefined : time(window.startMinute + 1)} value={time(window.endMinute)} onChange={event => { const end = minute(event.target.value); change(index, { endMinute: end === 0 ? 1440 : end }); }} /></label><Tooltip label={`Remove ${days[day]} hours`}><Button type="button" variant="quiet" className="h-11 w-11 shrink-0 !p-0" onClick={() => onWindows(windows.filter((_, position) => position !== index))}>×</Button></Tooltip></div> : null)}{!windows.some(window => window.weekday === day) ? <p className="flex min-h-11 items-center text-sm text-soft">Unavailable</p> : null}</div>
    </div> : null}
  </div>;
}
