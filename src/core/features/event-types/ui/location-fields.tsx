import { SectionHeading } from "../../../app/ui/page-header";
import { useEffect, useId, useState } from "react";
import { Card, Button, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import { offeredLocations, type EventLocationOption } from "../locations";
import type { EventDetailsInput, EventTypeInput } from "../repository";
import { FieldFailed, FieldSaved, type EventFieldSaving } from "./event-field-saving";

const labels = { google_meet: "Google Meet", fixed_link: "Meeting link", phone: "Host phone number", invitee_phone: "Invitee phone number", in_person: "In person", ask_invitee: "Ask invitee", custom: "Custom instruction" } as const;
type Props = EventFieldSaving & { compact?: boolean; event: EventTypeInput; update<K extends keyof EventDetailsInput>(key: K, value: EventDetailsInput[K]): void };

function CompactLocationFields({ event, update, ...saving }: Props) {
  const id = useId();
  const [editingLabel, setEditingLabel] = useState<string>();
  useEffect(() => { if (editingLabel !== undefined) document.getElementById(`${id}-public-label`)?.focus(); }, [editingLabel, id]);
  const locations = offeredLocations(event);
  const choose = saving.choose ?? update;
  function change(index: number, patch: Partial<EventLocationOption>, immediate = false) {
    (immediate ? choose : update)("locations", locations.map((location, position) => position === index ? { ...location, ...patch } : location));
  }
  return <fieldset className="grid min-w-0 gap-2 border-0 p-0">
    <legend className="mb-2 w-full text-sm font-[650]"><span className="flex items-center justify-between gap-3">Where<FieldSaved saving={saving} field="locations" /></span></legend>
    <div className="grid min-w-0 gap-4">{locations.map((location, index) => <div key={location.id} className="grid min-w-0 gap-1">
      <div className="grid min-w-0 items-start gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Select aria-label={locations.length === 1 ? "Location kind" : `Location ${index + 1} kind`} value={location.type} onChange={entry => { const type = entry.target.value as EventLocationOption["type"]; change(index, { type, label: labels[type], value: "", prompt: type === "ask_invitee" ? "Where should we meet?" : undefined }, true); }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select>
        {location.type === "google_meet" ? <p className="flex min-h-11 items-center text-sm text-soft">A meeting link is added when booked.</p> : location.type === "invitee_phone" ? <p className="flex min-h-11 items-center text-sm text-soft">Invitees give the number to call.</p> : <Input aria-label={location.type === "ask_invitee" ? "Required invitee prompt" : location.type === "custom" ? "Private instruction" : "Private link, number, or address"} aria-describedby={saving.state?.("locations").failed ? `${id}-failed` : undefined} required maxLength={location.type === "ask_invitee" ? 500 : 1000} value={location.type === "ask_invitee" ? location.prompt ?? "" : location.value} onBlur={() => saving.onLeave?.("locations")} onChange={entry => change(index, location.type === "ask_invitee" ? { prompt: entry.target.value } : { value: entry.target.value })} />}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-2">
        {editingLabel === location.id ? <label className="mt-2 grid min-w-0 flex-1 gap-2 text-sm font-[650]">Public label<Input id={`${id}-public-label`} required maxLength={180} value={location.label} onChange={entry => change(index, { label: entry.target.value })} onBlur={() => { saving.onLeave?.("locations"); setEditingLabel(undefined); }} /></label> : <button type="button" className="min-h-11 sm:min-h-7 min-w-0 py-2 text-left text-[13px] leading-5 text-soft underline decoration-line underline-offset-4" onClick={() => setEditingLabel(location.id)}>Invitees see “{location.label}” until they book.</button>}
        {locations.length > 1 ? <Tooltip label="Remove place"><Button type="button" variant="quiet" className="h-11 w-11 shrink-0 !px-0 text-xl" onClick={() => choose("locations", locations.filter((_, position) => position !== index))}><span aria-hidden="true">×</span></Button></Tooltip> : null}
      </div>
    </div>)}</div>
    {locations.length < 8 ? <div><Button type="button" variant="quiet" className="sm:min-h-8" onClick={() => choose("locations", [...locations, { id: crypto.randomUUID(), type: "fixed_link", label: "Meeting link", value: "" }])}>Add another place</Button></div> : null}
    <FieldFailed saving={saving} field="locations" id={`${id}-failed`} what="the place" />
  </fieldset>;
}

export function LocationFields(props: Props) {
  return props.compact ? <CompactLocationFields {...props} /> : <LegacyLocationFields {...props} />;
}

function LegacyLocationFields({ event, update }: { event: EventTypeInput; update<K extends keyof EventDetailsInput>(key: K, value: EventDetailsInput[K]): void }) {
  const locations = offeredLocations(event);
  function change(index: number, patch: Partial<EventLocationOption>) {
    update("locations", locations.map((location, position) => position === index ? { ...location, ...patch } : location));
  }
  return <Card className="p-5 sm:p-6"><SectionHeading icon="pin" title="Location and delivery" description="Offer one or more locations. Guests see labels before confirmation; private details are shared only with the booked guest." /><div className="mt-5 grid gap-5">{locations.map((location, index) => <fieldset key={location.id} className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2"><legend className="px-2 text-sm font-semibold">Location {index + 1}</legend><label className="grid gap-2 text-sm font-semibold">Location kind<Select value={location.type} onChange={entry => { const type = entry.target.value as EventLocationOption["type"]; change(index, { type, label: labels[type], value: "", prompt: type === "ask_invitee" ? "Where should we meet? Enter an address, phone number or link." : undefined }); }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label><label className="grid gap-2 text-sm font-semibold">Public label<Input required maxLength={180} value={location.label} onChange={entry => change(index, { label: entry.target.value })} /></label>{location.type === "google_meet" ? <p className={noticeClassName("warning", "sm:col-span-2")}>Google Meet is provisioned after confirmation. Publication checks conferencing capability.</p> : location.type === "ask_invitee" ? <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Required invitee prompt<Input required maxLength={500} value={location.prompt ?? ""} onChange={entry => change(index, { prompt: entry.target.value })} /></label> : location.type === "invitee_phone" ? <p className="text-sm text-soft sm:col-span-2">The guest must enter a valid phone number before confirming. The host calls this number.</p> : <label className="grid gap-2 text-sm font-semibold sm:col-span-2">{location.type === "custom" ? "Private instruction" : "Private link, number, or address"}<Input required maxLength={1000} value={location.value} onChange={entry => change(index, { value: entry.target.value })} /></label>}{locations.length > 1 ? <Button type="button" variant="quiet" onClick={() => update("locations", locations.filter((_, position) => position !== index))}>Remove location {index + 1}</Button> : null}</fieldset>)}{locations.length < 8 ? <div><Button type="button" variant="quiet" onClick={() => update("locations", [...locations, { id: crypto.randomUUID(), type: "fixed_link", label: "Meeting link", value: "" }])}>Add location</Button></div> : null}</div></Card>;
}
