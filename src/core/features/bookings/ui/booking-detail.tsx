import { useEffect, useState } from "react";
import { useDocumentInstant } from "../../../app/document-data";
import { ExtensionSlot } from "../../../app/extensions";
import { Badge, Button, Input } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";
import { BookingChanges } from "./booking-changes";
import { useBookingDeliveries } from "./delivery-actions";
import { timeRange } from "./operator-time";
import { BookingHistory } from "./booking-history";
import { calendarStatus, meetingStatus } from "../../../shared/booking-status";
import { RescheduleRequestSummary } from "./reschedule-request-summary";
import { BookingMoney } from "./booking-money";

/** The booking record (OPER-004) as its own page: on the white column with no card, the invitee's name its one title (DW6). */
export function BookingDetail({ booking, onChanged, onCancel, onAttendance, onErased }: { booking: BookingRecord; onChanged(notice?: string): Promise<void>; onCancel(id: string): Promise<void>; onAttendance(id: string, status: "attended" | "no_show", note: string): Promise<void>; onErased(notice: string, id: string): void }) {
  const delivery = useBookingDeliveries({ bookingId: booking.id, onErased });
  const instant = useDocumentInstant();
  const [now, setNow] = useState(instant);
  const [note, setNote] = useState("");
  useEffect(() => {
    const update = () => setNow(new Date().toISOString());
    update(); const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const ended = Date.parse(booking.occurrence.endAt) <= Date.parse(now);
  const canAttend = booking.state !== "cancelled" && !booking.attendance;
  // The attendance note (BOOK-011) is optional and goes in the same request as the mark; it never asks through a browser prompt.
  const mark = (status: "attended" | "no_show") => void onAttendance(booking.id, status, note.trim());
  // An ended booking's next step is its mark, the record's one ink pill; before it ends the mark waits in More.
  const attended = <Button variant={ended ? "primary" : "secondary"} type="button" onClick={() => mark("attended")}>Mark attended</Button>;
  return <article className="min-w-0" data-booking-detail={booking.id}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 break-words"><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">{booking.eventTitle}</p><h1 className="mt-2 text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] sm:text-[40px]">{booking.inviteeName}</h1><p className="mt-2 text-[15px] text-soft">{booking.inviteeEmail}</p><p className="mt-1 text-sm text-muted">Times in {booking.hostTimezone}</p></div><div className="flex flex-wrap gap-2">{booking.imported ? <Badge>Imported</Badge> : null}<BookingBadge state={booking.state} /></div></div>
    <dl className="mt-6 grid gap-x-6 gap-y-4 border-y border-line-soft py-5 sm:grid-cols-2">
      <Fact label={booking.inviteeTimezone === booking.hostTimezone ? "Time" : "Host time"} value={timeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.hostTimezone)} />
      {booking.inviteeTimezone !== booking.hostTimezone ? <Fact label="Invitee time" value={`${timeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.inviteeTimezone)} (${booking.inviteeTimezone})`} /> : null}
      {booking.lockedTimezone ? <><Fact label="Meeting timezone" value={booking.lockedTimezone} /><Fact label="Invitee browser zone" value={booking.browserTimezone ?? "Zone not provided by invitee"} /></> : null}
      <Fact label="Location" value={booking.meetingUrl || booking.locationValue || booking.locationLabel} />{booking.attendance ? <Fact label="Attendance" value={booking.attendance.status === "attended" ? "Attended" : "No-show"} /> : null}<Fact label="Calendar delivery" value={booking.imported ? "Original calendar entry retained" : calendarStatus(booking.calendarState)} /><Fact label="Meeting" value={meetingStatus(booking.meetingState)} />
      {Object.keys(booking.attribution).length ? <div className="sm:col-span-2"><dt className="text-[13px] font-[650] text-muted">Booking source</dt><dd className="mt-2 grid gap-2">{Object.entries(booking.attribution).map(([key, value]) => <span className="break-words text-[15px]" key={key}><strong>{key}: </strong>{value}</span>)}</dd></div> : null}
      {booking.answers.length ? <div className="sm:col-span-2"><dt className="text-[13px] font-[650] text-muted">Answers</dt><dd className="mt-2 grid gap-2">{booking.answers.map((answer) => <span className="break-words rounded-xl bg-row px-3.5 py-3 text-[15px]" key={answer.key}><strong>{answer.label}: </strong>{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value}</span>)}</dd></div> : null}
    </dl>
    <BookingMoney key={`${booking.id}:${booking.state}:${booking.attendance?.status ?? ""}`} bookingId={booking.id} timezone={booking.hostTimezone} noShow={booking.attendance?.status === "no_show"} onChanged={onChanged} />
    <ExtensionSlot id="booking.detail.sidebar.after.v1" entityId={booking.id} />
    <RescheduleRequestSummary booking={booking} />
    <BookingChanges key={booking.occurrence.id} booking={booking} onChanged={onChanged} onCancel={onCancel} renderActions={(primary, advanced) => <>
      <div className="flex flex-wrap gap-3">{primary}{canAttend && ended ? attended : null}</div>
      <details className="dial-more"><summary>More</summary><div className="flex flex-wrap gap-3 pt-3">
        {advanced}
        {canAttend ? <div className="flex basis-full flex-wrap items-end gap-3">
          <label className="grid w-full min-w-0 gap-2 text-sm font-[650] text-ink sm:w-64">Note<Input value={note} maxLength={4000} onChange={event => setNote(event.target.value)} /></label>
          {!ended ? attended : null}<Button variant="secondary" type="button" onClick={() => mark("no_show")}>Mark no-show</Button>
        </div> : null}
        {delivery.actions}
      </div></details>
    </>} />
    {delivery.content}
    <BookingHistory booking={booking} />
  </article>;
}
export function BookingBadge({ state }: { state: BookingRecord["state"] }) { return state === "confirmed" ? null : <Badge tone={state === "cancelled" ? "danger" : state === "rescheduled" ? "warning" : "success"}>{state}</Badge>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[13px] font-[650] text-muted">{label}</dt><dd className="mt-1 break-words text-[15px] text-ink">{value}</dd></div>; }
