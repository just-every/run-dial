import { formatTimezoneLabel } from "../../../shared/timezone-lock";
import { formatTime, formatDay } from "./invitee-time";
import { inviteeRecommendations } from "./slot-recommendations";
import { dateInZone, groupSlotsByDay, slotTimeLabel, shiftHostDate, type PickerAvailability, type PickerSlot } from "./day-picker-model";
export function DayTimePicker({ availability, timezone, hostTimezone, selectedDay, onDay, onSelect, disabled = false, lockedTimezone }: { lockedTimezone?: string | null; availability: Extract<PickerAvailability, { state: "available" }>; timezone: string; hostTimezone: string; selectedDay?: string; onDay: (day: string) => void; onSelect: (slot: PickerSlot) => void; disabled?: boolean }) {
  const days = groupSlotsByDay(availability.slots, timezone);
  if (selectedDay && /^\d{4}-\d{2}-\d{2}$/.test(selectedDay) && selectedDay >= shiftHostDate(availability.week, -1) && selectedDay <= shiftHostDate(availability.week, 7) && Number.isFinite(Date.parse(`${selectedDay}T12:00:00Z`)) && !days.some(item => item.date === selectedDay)) {
    days.push({ date: selectedDay, slots: [] }); days.sort((a, b) => a.date.localeCompare(b.date));
  }
  const day = days.find(item => item.date === selectedDay) ?? days[0];
  const suggestions = inviteeRecommendations(availability.rankedSlots.filter(slot => dateInZone(slot.startAt, timezone) === day?.date), timezone, hostTimezone);
  const suggested = new Set(suggestions.map(slot => slot.startAt));
  const otherTimes = day?.slots.filter(slot => !suggested.has(slot.startAt)) ?? [];
  const time = (slot: PickerSlot, reason?: string) => {
    return <button type="button" key={slot.startAt} className="pb-slot-button" data-start-at={slot.startAt} disabled={disabled} onClick={() => onSelect(slot)}><span>{lockedTimezone ? slotTimeLabel(slot.startAt, timezone) : formatTime(slot.startAt, timezone)}</span>{lockedTimezone ? <small>{formatTimezoneLabel(slot.startAt, lockedTimezone)}</small> : null}{reason ? <em>{reason}</em> : null}</button>;
  };
  return <div className="pb-day-picker">{!lockedTimezone && hostTimezone !== timezone ? <p className="pb-picker-host-zone">Host time: {hostTimezone}</p> : null}<div role="group" aria-label="Choose a day" className="pb-picker-days">{days.map(item => <button type="button" className="pb-picker-day" data-date={item.date} key={item.date} aria-pressed={item.date === day?.date} disabled={disabled} onClick={() => onDay(item.date)}>{formatDay(item.date)}</button>)}</div>{day?.slots.length ? <><section aria-label="Suggested times" className="pb-suggested-times"><h2>Suggested times</h2><div className="pb-time-chips">{suggestions.map(slot => time(slot, slot.reason))}</div></section>{otherTimes.length ? <section aria-label="Other available times"><h2>Other times</h2><div className="pb-time-chips">{otherTimes.map(slot => time(slot))}</div></section> : null}</> : <p className="pb-slot-empty">{day ? "No times are left on this day. Choose another day or week." : "No times are open for this week. Try the next week or send a request."}</p>}</div>;
}
