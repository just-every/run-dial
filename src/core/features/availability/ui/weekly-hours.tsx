import { useId } from "react";
import { Input } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import type { AvailabilityWindowInput } from "../../event-types";
import { timeInput, timeMinutes } from "./window-time";

const weekdays = [[1, "Monday", "Mon"], [2, "Tuesday", "Tue"], [3, "Wednesday", "Wed"], [4, "Thursday", "Thu"], [5, "Friday", "Fri"], [6, "Saturday", "Sat"], [0, "Sunday", "Sun"]] as const;
const iconButton = "grid size-11 shrink-0 place-items-center rounded-full bg-wash text-xl text-ink hover:bg-gold-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The same seven compact, directly editable day rows wherever a set of hours is used. */
export function WeeklyHours({ windows, onChange, label = "Weekly hours" }: { windows: AvailabilityWindowInput[]; onChange(windows: AvailabilityWindowInput[]): void; label?: string }) {
  const id = useId();
  return <div role="group" aria-label={label} className="grid gap-1">
    {weekdays.map(([weekday, day, short]) => <div key={weekday} role="group" aria-label={day} className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem] items-start gap-2">
      <span className="flex min-h-11 items-center text-sm font-semibold" aria-hidden="true">{short}</span>
      <div className="flex min-w-0 flex-wrap gap-2">
        {windows.filter(window => window.weekday === weekday).length ? windows.map((window, position) => window.weekday === weekday ? <div key={position} className="grid w-full min-w-0 max-w-[16rem] grid-cols-[minmax(0,1fr)_2.75rem] items-start gap-1">
          <details className="min-w-0">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-full bg-wash px-2 text-[13px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" aria-label={`${day} ${clockLabel(window.startMinute)}–${clockLabel(window.endMinute)}`}>
              {clockLabel(window.startMinute)}–{clockLabel(window.endMinute)}
            </summary>
            <div className="grid min-w-0 gap-2 pt-2">
              <label className="grid min-w-0 gap-1 text-[13px] text-soft">From<Input type="time" className="min-w-0 px-2 text-[13px]" aria-label={`${day} window ${indexOnDay(windows, position)} start time`} aria-invalid={window.endMinute <= window.startMinute || undefined} aria-describedby={window.endMinute <= window.startMinute ? `${id}-${position}-error` : undefined} value={timeInput(window.startMinute)} onChange={event => {
                const minute = timeMinutes(event.target.value);
                if (Number.isFinite(minute)) onChange(windows.map((current, index) => index === position ? { ...current, startMinute: minute } : current));
              }} /></label>
              <label className="grid min-w-0 gap-1 text-[13px] text-soft">Until<Input type="time" className="min-w-0 px-2 text-[13px]" aria-label={`${day} window ${indexOnDay(windows, position)} end time`} aria-invalid={window.endMinute <= window.startMinute || undefined} aria-describedby={window.endMinute <= window.startMinute ? `${id}-${position}-error` : undefined} value={timeInput(window.endMinute)} onChange={event => {
                const minute = timeMinutes(event.target.value, true);
                if (Number.isFinite(minute)) onChange(windows.map((current, index) => index === position ? { ...current, endMinute: minute } : current));
              }} /></label>
            </div>
            {window.endMinute <= window.startMinute ? <p id={`${id}-${position}-error`} role="alert" className="mt-2 text-sm text-danger">Ends before it starts. Choose a later end time.</p> : null}
          </details>
          <Tooltip label="Remove hours"><button type="button" className={iconButton} onClick={() => onChange(windows.filter((_, index) => index !== position))}><span aria-hidden="true">×</span></button></Tooltip>
        </div> : null) : <span className="flex min-h-11 items-center text-sm text-muted">Unavailable</span>}
      </div>
      <Tooltip label="Add hours"><button type="button" className={iconButton} onClick={() => onChange([...windows, nextWindow(windows, weekday)])}><span aria-hidden="true">+</span></button></Tooltip>
    </div>)}
  </div>;
}

function indexOnDay(windows: AvailabilityWindowInput[], position: number) { return windows.slice(0, position + 1).filter(window => window.weekday === windows[position].weekday).length; }
function nextWindow(windows: AvailabilityWindowInput[], weekday: number): AvailabilityWindowInput {
  const end = Math.max(0, ...windows.filter(window => window.weekday === weekday).map(window => window.endMinute));
  const startMinute = end && end < 1380 ? end : 540;
  return { weekday, startMinute, endMinute: end && end < 1380 ? Math.min(1440, startMinute + 60) : 1020 };
}

export function clockLabel(minutes: number) {
  const value = minutes === 1440 ? 0 : minutes;
  const hour = Math.floor(value / 60), minute = value % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
}

export function hoursSummary(windows: AvailabilityWindowInput[]) {
  if (!windows.length) return "No hours yet";
  const grouped = new Map<string, string[]>();
  for (const [weekday, , short] of weekdays) {
    const ranges = windows.filter(window => window.weekday === weekday).map(window => `${clockLabel(window.startMinute)}–${clockLabel(window.endMinute)}`).join(", ");
    if (ranges) grouped.set(ranges, [...(grouped.get(ranges) ?? []), short]);
  }
  return [...grouped].map(([ranges, days]) => `${days.join(", ")} ${ranges}`).join(" · ");
}
