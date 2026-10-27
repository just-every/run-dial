import { useId, useRef, useState, type KeyboardEvent } from "react";
import { operatorTimeRange } from "../../shared/operator-format";
import { groupSlotsByDay, type PickerSlot } from "../public-booking";
import "./offered-time-choices.css";

/** Each day's toolbar is one tab stop; arrows reach every live time within it. */
export function OfferedTimeChoices({ slots, timezone, selected, onToggle, pending = false }: {
  slots: PickerSlot[];
  timezone: string;
  selected: PickerSlot[];
  onToggle(slot: PickerSlot): void;
  pending?: boolean;
}) {
  const instructions = useId();
  const days = groupSlotsByDay(slots, timezone);
  const [activeDate, setActiveDate] = useState("");
  const active = days.some(day => day.date === activeDate) ? activeDate : days[0]?.date;
  return <div className="grid gap-3">
    <p id={instructions} className="sr-only">Tab between days. Use arrow keys to move between times, and Space to select.</p>
    <div className="grid grid-cols-4 gap-2 sm:hidden" aria-label="Choose day">
      {days.map(day => <button key={day.date} type="button" aria-pressed={day.date === active} onClick={() => setActiveDate(day.date)} className={`min-h-11 rounded-full px-2 text-sm font-semibold ${day.date === active ? "bg-gold-wash text-ink" : "bg-wash text-soft"}`}>{dayTitle(day.date)}</button>)}
    </div>
    <div className="grid max-h-80 content-start gap-4 overflow-y-auto py-2">
      {!slots.length ? <p className="text-sm text-soft">{pending ? "Checking available times…" : "No available times this week. Choose another week."}</p> : days.map(day => <div key={day.date} className="offered-day" data-active={day.date === active}><DayChoices date={day.date} slots={day.slots} timezone={timezone} selected={selected} onToggle={onToggle} instructions={instructions} /></div>)}
    </div>
  </div>;
}

function DayChoices({ date, slots, timezone, selected, onToggle, instructions }: {
  date: string;
  slots: PickerSlot[];
  timezone: string;
  selected: PickerSlot[];
  onToggle(slot: PickerSlot): void;
  instructions: string;
}) {
  const label = useId();
  const controls = useRef(new Map<string, HTMLInputElement>());
  const [active, setActive] = useState(slots[0]?.startAt);
  const checked = new Set(selected.map(slot => slot.startAt));
  const enabled = slots.filter(slot => selected.length < 12 || checked.has(slot.startAt));
  const tabStop = enabled.find(slot => slot.startAt === active)?.startAt ?? enabled[0]?.startAt;

  function move(event: KeyboardEvent<HTMLInputElement>, startAt: string) {
    const index = enabled.findIndex(slot => slot.startAt === startAt);
    let next: number;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": next = (index + 1) % enabled.length; break;
      case "ArrowLeft": case "ArrowUp": next = (index - 1 + enabled.length) % enabled.length; break;
      case "Home": next = 0; break;
      case "End": next = enabled.length - 1; break;
      default: return;
    }
    event.preventDefault();
    controls.current.get(enabled[next].startAt)?.focus();
  }

  return <div className="min-w-0">
    <p id={label} className="sr-only mb-2 text-sm font-semibold sm:not-sr-only">{dayTitle(date)}</p>
    <div role="toolbar" aria-labelledby={label} aria-describedby={instructions} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {slots.map(slot => {
        const isChecked = checked.has(slot.startAt);
        return <label key={slot.startAt} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${isChecked ? "bg-gold-wash" : "bg-wash"}`}>
          <input ref={element => { if (element) controls.current.set(slot.startAt, element); else controls.current.delete(slot.startAt); }} type="checkbox" checked={isChecked} disabled={!isChecked && selected.length >= 12} tabIndex={slot.startAt === tabStop ? 0 : -1} onFocus={() => setActive(slot.startAt)} onKeyDown={event => move(event, slot.startAt)} onChange={() => onToggle(slot)} />
          <span>{operatorTimeRange(slot.startAt, slot.endAt, timezone, false)}</span>
        </label>;
      })}
    </div>
  </div>;
}

function dayTitle(date: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(`${date}T12:00:00Z`)).map(part => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}
