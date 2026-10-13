import { dateInZone, groupSlotsByDay, dayLabel, hostTimeLabel, slotTimeLabel, type PickerAvailability, type PickerSlot } from "./day-picker-model";
export function DayTimePicker({ availability, timezone, hostTimezone, selectedDay, onDay, onSelect, disabled = false }: { availability: Extract<PickerAvailability, { state: "available" }>; timezone: string; hostTimezone: string; selectedDay?: string; onDay: (day: string) => void; onSelect: (slot: PickerSlot) => void; disabled?: boolean }) {
  const days = groupSlotsByDay(availability.slots, timezone);
  const day = days.find(item => item.date === selectedDay) ?? days[0];
  const suggestions = availability.rankedSlots.filter(slot => dateInZone(slot.startAt, timezone) === day?.date).slice(0, 5);
  const suggested = new Set(suggestions.map(slot => slot.startAt));
  const time = (slot: PickerSlot, reason?: string) => {
    const host = hostTimeLabel(slot.startAt, hostTimezone, timezone, false);
    return <button type="button" key={slot.startAt} className="pb-slot-button" data-start-at={slot.startAt} disabled={disabled} onClick={() => onSelect(slot)}><span>{slotTimeLabel(slot.startAt, timezone)}</span>{host ? <small>{host}</small> : null}{reason ? <em>{reason}</em> : null}</button>;
  };
  return <div className="pb-day-picker">{hostTimezone !== timezone ? <p className="pb-picker-host-zone">Host times in {hostTimezone}</p> : null}<div role="group" aria-label="Choose a day" className="pb-picker-days">{days.map(item => <button type="button" className="pb-picker-day" data-date={item.date} key={item.date} aria-pressed={item.date === day?.date} disabled={disabled} onClick={() => onDay(item.date)}>{dayLabel(item.date)}</button>)}</div>{day ? <><section aria-label="Suggested times" className="pb-suggested-times"><h2>Suggested times</h2><div className="pb-time-chips">{suggestions.map(slot => time(slot, slot.reason))}</div></section><section aria-label="Other available times"><h2>Other times</h2><div className="pb-time-chips">{day.slots.filter(slot => !suggested.has(slot.startAt)).map(slot => time(slot))}</div></section></> : <p className="pb-slot-empty">No times are open for this week. Try the next week or send a request.</p>}</div>;
}
