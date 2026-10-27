import { useEffect, useId, useState } from "react";
import { Button, Input, Select } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import type { EventDetailsInput, EventTypeInput } from "../repository";
import { eventDurationOptions } from "../../../shared/event-duration";
import { FieldFailed, FieldSaved, type EventFieldSaving } from "./event-field-saving";

type Props = EventFieldSaving & { compact?: boolean; event: EventTypeInput; update<K extends keyof EventDetailsInput>(key: K, value: EventDetailsInput[K]): void };
const commonLengths = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 480];

function CompactDurationFields({ event, update, ...saving }: Props) {
  const id = useId();
  const [custom, setCustom] = useState<number>();
  useEffect(() => { if (custom !== undefined) document.getElementById(`${id}-custom-length`)?.focus(); }, [custom, id]);
  const options = eventDurationOptions(event);
  const choose = saving.choose ?? update;
  function change(next: number[], immediate = true) {
    if (!next.includes(event.durationMinutes)) {
      // Stage the options first so one whole-object save carries a valid default.
      update("durationOptionsMinutes", next);
      choose("durationMinutes", next[0]);
    } else (immediate ? choose : update)("durationOptionsMinutes", next);
  }
  return <fieldset className="grid min-w-0 gap-2 border-0 p-0">
    <legend className="mb-2 w-full text-sm font-[650]"><span className="flex items-center justify-between gap-3">Length<FieldSaved saving={saving} field="durationOptionsMinutes" /></span></legend>
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="grid min-w-0 flex-1 gap-3">
        {options.map((value, index) => <div key={index} className="flex min-w-0 items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2">
            <Select aria-label={options.length === 1 ? "Length" : `Length ${index + 1}`} aria-describedby={saving.state?.("durationOptionsMinutes").failed ? `${id}-failed` : undefined} value={custom === index ? "other" : value} onBlur={() => saving.onLeave?.("durationOptionsMinutes")} onChange={entry => {
              if (entry.target.value === "other") { setCustom(index); return; }
              setCustom(undefined);
              change(options.map((duration, position) => position === index ? Number(entry.target.value) : duration));
            }}>
              {[...new Set([...commonLengths, value])].sort((a, b) => a - b).map(length => <option key={length} value={length} disabled={length !== value && options.includes(length)}>{length} min</option>)}
              <option value="other">Other length…</option>
            </Select>
            {custom === index ? <Input id={`${id}-custom-length`} aria-label={`Length ${index + 1} in minutes`} type="number" min={5} max={480} required value={value} onChange={entry => change(options.map((duration, position) => position === index ? Number(entry.target.value) : duration), false)} onBlur={() => saving.onLeave?.("durationOptionsMinutes")} /> : null}
          </div>
          {options.length > 1 ? <Tooltip label="Remove length"><Button type="button" variant="secondary" className="h-11 w-11 shrink-0 !px-0 text-xl" onClick={() => { change(options.filter((_, position) => position !== index)); setCustom(undefined); }}><span aria-hidden="true">×</span></Button></Tooltip> : null}
        </div>)}
      </div>
      {options.length < 4 ? <Button type="button" variant="quiet" onClick={() => change([...options, [60, 15, 45, 90, 120].find(value => !options.includes(value))!])}>Add a length</Button> : null}
    </div>
    {options.length > 1 ? <div className="grid gap-2 text-sm font-[650]"><div className="flex items-center justify-between gap-3"><label htmlFor={`${id}-default`}>Default</label><FieldSaved saving={saving} field="durationMinutes" /></div><Select id={`${id}-default`} value={event.durationMinutes} onBlur={() => saving.onLeave?.("durationMinutes")} onChange={entry => choose("durationMinutes", Number(entry.target.value))}>{options.map((value, index) => <option key={index} value={value}>{value} min</option>)}</Select></div> : null}
    <FieldFailed saving={saving} field="durationOptionsMinutes" id={`${id}-failed`} what="the lengths" />
    <FieldFailed saving={saving} field="durationMinutes" id={`${id}-default-failed`} what="the default length" />
  </fieldset>;
}

export function DurationFields(props: Props) {
  return props.compact ? <CompactDurationFields {...props} /> : <LegacyDurationFields {...props} />;
}

function LegacyDurationFields({ event, update }: Props) {
  const options = eventDurationOptions(event);
  function change(next: number[]) {
    update("durationOptionsMinutes", next);
    if (!next.includes(event.durationMinutes)) update("durationMinutes", next[0]);
  }
  return <fieldset className="mt-5 grid gap-3"><legend className="text-sm font-[650]">Duration options</legend><p className="text-sm text-soft">Offer up to four lengths. Guests choose before selecting a time.</p><div className="grid gap-3 sm:grid-cols-2">{options.map((value, index) => <div key={index} className="flex items-end gap-2"><label className="grid min-w-0 flex-1 gap-2 text-sm font-[650]">Duration {index + 1} (minutes)<Input type="number" min="5" max="480" required value={value} onChange={entry => change(options.map((duration, position) => position === index ? Number(entry.target.value) : duration))} /></label><Button type="button" variant="quiet" disabled={options.length === 1} aria-label={`Remove duration ${index + 1}`} onClick={() => change(options.filter((_, position) => position !== index))}>Remove</Button></div>)}</div><div className="flex flex-wrap items-end gap-3"><Button type="button" variant="secondary" disabled={options.length >= 4} onClick={() => change([...options, [60, 15, 45, 90, 120].find(value => !options.includes(value))!])}>Add duration</Button><label className="grid gap-2 text-sm font-[650]">Default duration<Select value={event.durationMinutes} onChange={entry => update("durationMinutes", Number(entry.target.value))}>{options.map((value, index) => <option key={index} value={value}>{value} minutes</option>)}</Select></label></div></fieldset>;
}
