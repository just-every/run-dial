import { Button, Input, Select } from "../../../app/ui/primitives";
import type { EventTypeInput } from "../repository";
import { eventDurationOptions } from "../../../shared/event-duration";

type Props = { event: EventTypeInput; update<K extends keyof EventTypeInput>(key: K, value: EventTypeInput[K]): void };
export function DurationFields({ event, update }: Props) {
  const options = eventDurationOptions(event);
  function change(next: number[]) {
    update("durationOptionsMinutes", next);
    if (!next.includes(event.durationMinutes)) update("durationMinutes", next[0]);
  }
  return <fieldset className="mt-5 grid gap-3"><legend className="text-sm font-[650]">Duration options</legend><p className="text-sm text-soft">Offer up to four lengths. Guests choose before selecting a time.</p><div className="grid gap-3 sm:grid-cols-2">{options.map((value, index) => <div key={index} className="flex items-end gap-2"><label className="grid min-w-0 flex-1 gap-2 text-sm font-[650]">Duration {index + 1} (minutes)<Input type="number" min="5" max="480" required value={value} onChange={entry => change(options.map((duration, position) => position === index ? Number(entry.target.value) : duration))} /></label><Button type="button" variant="quiet" disabled={options.length === 1} aria-label={`Remove duration ${index + 1}`} onClick={() => change(options.filter((_, position) => position !== index))}>Remove</Button></div>)}</div><div className="flex flex-wrap items-end gap-3"><Button type="button" variant="secondary" disabled={options.length >= 4} onClick={() => change([...options, [60, 15, 45, 90, 120].find(value => !options.includes(value))!])}>Add duration</Button><label className="grid gap-2 text-sm font-[650]">Default duration<Select value={event.durationMinutes} onChange={entry => update("durationMinutes", Number(entry.target.value))}>{options.map((value, index) => <option key={index} value={value}>{value} minutes</option>)}</Select></label></div></fieldset>;
}
