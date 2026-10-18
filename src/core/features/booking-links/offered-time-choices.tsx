import { useId, useRef, useState, type KeyboardEvent } from "react";
import { dayLabel, groupSlotsByDay, slotTimeLabel, type PickerSlot } from "../public-booking";

/** Each day's toolbar is one tab stop; arrows reach every live time within it. */
export function OfferedTimeChoices({ slots, timezone, selected, onToggle }: {
  slots: PickerSlot[];
  timezone: string;
  selected: PickerSlot[];
  onToggle(slot: PickerSlot): void;
}) {
  const instructions = useId();
  return <div className="grid gap-3">
    <p id={instructions} className="text-sm text-soft">Tab between days. Use arrow keys to move between times, and Space to select.</p>
    <div className="grid max-h-80 gap-4 overflow-y-auto rounded-xl border border-line p-3">
      {!slots.length ? <p className="text-sm text-soft">No available times this week. Choose another week.</p> : groupSlotsByDay(slots, timezone).map(day => <DayChoices key={day.date} date={day.date} slots={day.slots} timezone={timezone} selected={selected} onToggle={onToggle} instructions={instructions} />)}
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
    <p id={label} className="mb-2 text-sm font-semibold">{dayLabel(date)}</p>
    <div role="toolbar" aria-labelledby={label} aria-describedby={instructions} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {slots.map(slot => {
        const isChecked = checked.has(slot.startAt);
        return <label key={slot.startAt} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${isChecked ? "border-ink bg-gold-wash" : "border-line"}`}>
          <input ref={element => { if (element) controls.current.set(slot.startAt, element); else controls.current.delete(slot.startAt); }} type="checkbox" checked={isChecked} disabled={!isChecked && selected.length >= 12} tabIndex={slot.startAt === tabStop ? 0 : -1} onFocus={() => setActive(slot.startAt)} onKeyDown={event => move(event, slot.startAt)} onChange={() => onToggle(slot)} />
          <span>{slotTimeLabel(slot.startAt, timezone)}</span>
        </label>;
      })}
    </div>
  </div>;
}
