import { cloneElement, useState, type ReactElement } from "react";
import { Input, Select, IconTile } from "../../../app/ui/primitives";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { useEventPage } from "./event-page-context";
import type { EventDetailsInput } from "../repository";

/** A length of time as people say it: "4 hours’", "1 day’s", "90 min", ready to precede "notice". */
function spoken(minutes: number) {
  const unit = minutes >= 1440 && minutes % 1440 === 0 ? ["day", minutes / 1440] as const : minutes >= 60 && minutes % 60 === 0 ? ["hour", minutes / 60] as const : undefined;
  return unit ? `${unit[1]} ${unit[0]}${unit[1] === 1 ? "’s" : "s’"}` : `${minutes} min`;
}

export function SchedulingLimits() {
  const { details } = useEventPage();
  const value = details.values;
  const [open, setOpen] = useState(false);
  const notice = `${spoken(value.minimumNoticeMinutes)} notice`, every = value.slotIncrementMinutes === 60 ? "hour" : `${value.slotIncrementMinutes} min`;
  const horizon = value.bookingHorizonMode === "indefinite" ? "no end date" : value.bookingHorizonMode === "fixed_range" ? `${value.bookingStartDate} – ${value.bookingEndDate}` : `up to ${value.bookingHorizonDays} ${value.bookingHorizonMode === "weekdays" ? "weekdays" : "days"} ahead`;
  function field(key: keyof EventDetailsInput, label: string, child: ReactElement<{ "aria-label"?: string }>) {
    return <div className="grid min-w-0 gap-2"><label className="grid gap-2 text-sm font-semibold"><span className="flex flex-wrap items-center justify-between gap-2">{label}<SavedMark state={details.state(key)} /></span>{cloneElement(child, { "aria-label": label })}</label><SaveFailed id={`schedule-${key}-error`} state={details.state(key)} what={label.toLowerCase()} problem={details.validation(key)} onRetry={details.retry} /></div>;
  }
  function number(key: "minimumNoticeMinutes" | "bookingHorizonDays" | "beforeBufferMinutes" | "afterBufferMinutes" | "hostDayBookingLimit", label: string, min: number, max?: number) {
    return field(key, label, <Input type="number" min={min} max={max} value={value[key] ?? ""} onChange={entry => details.type(key, entry.target.value === "" && key === "hostDayBookingLimit" ? null : Number(entry.target.value))} onBlur={() => details.leave(key)} />);
  }
  return <section className="mt-5 rounded-[22px] bg-card shadow-panel"><button type="button" className="flex min-h-[88px] w-full items-center gap-3 p-5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}><IconTile icon="notice" /><span className="min-w-0 flex-1"><span className="block font-bold">When it can be booked</span><span className="mt-1 block text-sm text-soft">Start every {every} · at least {notice} · {horizon}</span></span><span aria-hidden="true">{open ? "⌄" : "›"}</span></button>
    <div hidden={!open} className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
      {field("slotIncrementMinutes", "Start increment", <Select value={value.slotIncrementMinutes} onChange={entry => details.choose("slotIncrementMinutes", Number(entry.target.value) as EventDetailsInput["slotIncrementMinutes"])}>{[5, 10, 15, 30, 45, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</Select>)}
      {number("minimumNoticeMinutes", "Minimum notice (minutes)", 0, 10080)}
      {field("bookingHorizonMode", "Booking window", <Select value={value.bookingHorizonMode ?? "calendar_days"} onChange={entry => details.choose("bookingHorizonMode", entry.target.value as EventDetailsInput["bookingHorizonMode"])}><option value="calendar_days">Calendar days</option><option value="weekdays">Weekdays</option><option value="fixed_range">Date range</option><option value="indefinite">No end date</option></Select>)}
      {value.bookingHorizonMode === "fixed_range" ? <>{field("bookingStartDate", "First bookable date", <Input type="date" value={value.bookingStartDate ?? ""} onChange={entry => details.type("bookingStartDate", entry.target.value || null)} onBlur={details.leave} />)}{field("bookingEndDate", "Last bookable date", <Input type="date" min={value.bookingStartDate ?? undefined} value={value.bookingEndDate ?? ""} onChange={entry => details.type("bookingEndDate", entry.target.value || null)} onBlur={details.leave} />)}</> : value.bookingHorizonMode !== "indefinite" ? number("bookingHorizonDays", value.bookingHorizonMode === "weekdays" ? "Booking horizon (weekdays)" : "Booking horizon (days)", 1, 365) : null}
      {number("beforeBufferMinutes", "Before buffer (minutes)", 0, 120)}{number("afterBufferMinutes", "After buffer (minutes)", 0, 120)}{number("hostDayBookingLimit", "Host-day cap (optional)", 1)}
    </div>
  </section>;
}
