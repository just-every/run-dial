import { LocationFields } from "./location-fields";
import { DurationFields } from "./duration-fields";
import { useId, useState, type ReactNode } from "react";
import { FieldFailed, FieldSaved, type EventFieldSaving } from "./event-field-saving";
import { Card, IconTile, Input, Select, Textarea } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { IconName } from "../../../shared/drawing/icons";
import type { EventDetailsInput, EventTypeInput } from "../repository";

type Props = EventFieldSaving & { mode?: "essentials"; event: EventTypeInput; update<K extends keyof EventDetailsInput>(key: K, value: EventDetailsInput[K]): void };

export function EventFields({ event, update, mode, ...saving }: Props) {
  const [more, setMore] = useState(false);
  const id = useId();
  if (mode === "essentials") return <div className="grid min-w-0 gap-4">
    <div className="grid gap-2"><div className="flex items-center justify-between gap-3 text-sm font-[650]"><label htmlFor={`${id}-name`}>Name</label><FieldSaved saving={saving} field="title" /></div><Input aria-label="Name" id={`${id}-name`} value={event.title} onChange={entry => update("title", entry.target.value)} onBlur={() => saving.onLeave?.("title")} aria-describedby={saving.state?.("title").failed ? `${id}-name-failed` : undefined} required /><FieldFailed saving={saving} field="title" id={`${id}-name-failed`} what="the name" /></div>
    <div className="grid gap-2"><div className="flex items-center justify-between gap-3 text-sm font-[650]"><label htmlFor={`${id}-description`}>Description</label><FieldSaved saving={saving} field="description" /></div><Textarea className="event-essentials-description" aria-label="Description" id={`${id}-description`} value={event.description} onChange={entry => update("description", entry.target.value)} onBlur={() => saving.onLeave?.("description")} aria-describedby={saving.state?.("description").failed ? `${id}-description-failed` : undefined} required /><FieldFailed saving={saving} field="description" id={`${id}-description-failed`} what="the description" /></div>
    <DurationFields compact event={event} update={update} {...saving} />
    <LocationFields compact event={event} update={update} {...saving} />
  </div>;
  return <>
    <Card className="p-5 sm:p-6"><SectionHeading icon="file" title="Details" description="Start with the offer your guests will book." /><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Event name"><Input value={event.title} onChange={(entry) => update("title", entry.target.value)} required /></Field></div><DurationFields event={event} update={update} /></Card>
    <LocationFields event={event} update={update} />
    <Card className="p-5 sm:p-6"><Field label="Description" icon="file"><Textarea value={event.description} onChange={(entry) => update("description", entry.target.value)} required /></Field></Card>
    <Card className="p-5 sm:p-6"><details open={more} onToggle={(entry) => setMore(entry.currentTarget.open)} className="group"><summary className="flex cursor-pointer list-none items-center gap-3 max-sm:min-h-11 text-[19px] font-[750] tracking-[-.01em] [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-row"><span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-ink transition-transform group-open:rotate-90" /></span>More options</summary><div onInvalidCapture={() => setMore(true)} className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label="Slug"><Input value={event.slug} onChange={(entry) => update("slug", entry.target.value.toLowerCase())} required pattern={"[a-z0-9\\-]+"} maxLength={80} /></Field>
      <Field label="Colour"><Input type="color" className="h-11 p-1" value={event.color} onChange={(entry) => update("color", entry.target.value)} /></Field>
      <Field label="Start increment"><Select value={event.slotIncrementMinutes} onChange={(entry) => update("slotIncrementMinutes", Number(entry.target.value) as EventTypeInput["slotIncrementMinutes"])}>{[5, 10, 15, 30, 45, 60].map((value) => <option value={value} key={value}>{value} minutes</option>)}</Select></Field>
      <Field label="Minimum notice"><Input type="number" min="0" max="10080" value={event.minimumNoticeMinutes} onChange={(entry) => update("minimumNoticeMinutes", Number(entry.target.value))} /></Field>
      <Field label="Booking window"><Select value={event.bookingHorizonMode ?? "calendar_days"} onChange={entry => update("bookingHorizonMode", entry.target.value as EventTypeInput["bookingHorizonMode"])}><option value="calendar_days">Rolling calendar days</option><option value="weekdays">Rolling weekdays</option><option value="fixed_range">Fixed date range</option><option value="indefinite">Indefinite</option></Select></Field>
      {event.bookingHorizonMode === "fixed_range" ? <><Field label="First bookable date"><Input type="date" required value={event.bookingStartDate ?? ""} onChange={entry => update("bookingStartDate", entry.target.value || null)} /></Field><Field label="Last bookable date"><Input type="date" required min={event.bookingStartDate ?? undefined} value={event.bookingEndDate ?? ""} onChange={entry => update("bookingEndDate", entry.target.value || null)} /></Field></> : event.bookingHorizonMode === "indefinite" ? <p className="self-center text-sm text-soft">Times remain open up to the availability lookahead, rolling forward each day.</p> : <Field label={event.bookingHorizonMode === "weekdays" ? "Booking horizon (weekdays)" : "Booking horizon (days)"}><Input type="number" min="1" max="365" value={event.bookingHorizonDays} onChange={(entry) => update("bookingHorizonDays", Number(entry.target.value))} /></Field>}
      <Field label="Before buffer (minutes)"><Input type="number" min="0" max="120" value={event.beforeBufferMinutes} onChange={(entry) => update("beforeBufferMinutes", Number(entry.target.value))} /></Field>
      <Field label="After buffer (minutes)"><Input type="number" min="0" max="120" value={event.afterBufferMinutes} onChange={(entry) => update("afterBufferMinutes", Number(entry.target.value))} /></Field>
      <Field label="Host-day cap (optional)"><Input type="number" min="1" value={event.hostDayBookingLimit ?? ""} onChange={(entry) => update("hostDayBookingLimit", entry.target.value === "" ? null : Number(entry.target.value))} /></Field>
      <label className="flex items-center gap-3 text-sm font-[650]"><input className="h-[18px] w-[18px]" type="checkbox" checked={event.listed} onChange={(entry) => update("listed", entry.target.checked)} /> List this event on the public profile</label>
    </div></details></Card>
  </>;
}

function Field({ label, children, className = "", icon }: { label: string; children: ReactNode; className?: string; icon?: IconName }) {
  // With an icon, the label is the card's title: the description card has no other heading.
  return <label className={`grid gap-2 text-sm font-[650] ${className}`}>{icon ? <span className="mb-2 flex items-center gap-3 text-[19px] font-[750] tracking-[-.01em]"><IconTile icon={icon} />{label}</span> : <span>{label}</span>}{children}</label>;
}
