import { ExtensionSlot } from "../../../app/extensions";
import { Badge, Button, Card } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";
import { BookingChanges } from "./booking-changes";
import { DeliveryActions } from "./delivery-actions";
import { timeRange } from "./operator-time";
import { BookingHistory } from "./booking-history";

export function BookingDetail({ booking, onChanged, onCancel, onAttendance, onErased }: { booking: BookingRecord; onChanged(notice?: string): Promise<void>; onCancel(id: string): Promise<void>; onAttendance(id: string, status: "attended" | "no_show"): Promise<void>; onErased(notice: string, id: string): void }) {
  return <Card className="min-w-0 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 break-words"><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">{booking.eventTitle}</p><h2 className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-[-.02em]">{booking.inviteeName}</h2><p className="mt-2 text-[15px] text-soft">{booking.inviteeEmail}</p></div><div className="flex flex-wrap gap-2">{booking.imported ? <Badge>Imported</Badge> : null}<BookingBadge state={booking.state} /></div></div>
    <dl className="mt-6 grid gap-x-6 gap-y-4 border-y border-line-soft py-5 sm:grid-cols-2">
      <Fact label="Host time" value={timeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.hostTimezone)} />
      <Fact label="Invitee time" value={timeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.inviteeTimezone)} />
      <Fact label="Location" value={booking.meetingUrl || booking.locationValue || booking.locationLabel} /><Fact label="Calendar delivery" value={booking.imported ? "Original calendar entry retained" : booking.calendarState} /><Fact label="Meeting" value={booking.meetingState} />
      {booking.answers.length ? <div className="sm:col-span-2"><dt className="text-[13px] font-[650] text-muted">Answers</dt><dd className="mt-2 grid gap-2">{booking.answers.map((answer) => <span className="break-words rounded-xl bg-row px-3.5 py-3 text-[15px]" key={answer.key}><strong>{answer.label}: </strong>{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value}</span>)}</dd></div> : null}
    </dl>
    <ExtensionSlot id="booking.detail.sidebar.after.v1" entityId={booking.id} />
    <BookingChanges key={booking.occurrence.id} booking={booking} onChanged={onChanged} onCancel={onCancel} />
    {booking.attendance ? <p className="mt-5 text-sm font-semibold text-ink">Attendance: {booking.attendance.status.replace("_", " ")}</p> : <div className="mt-6 flex flex-wrap gap-3"><Button variant="secondary" type="button" onClick={() => void onAttendance(booking.id, "attended")}>Mark attended</Button><Button variant="secondary" type="button" onClick={() => void onAttendance(booking.id, "no_show")}>Mark no-show</Button></div>}
    <DeliveryActions bookingId={booking.id} onErased={onErased} />
    <BookingHistory booking={booking} />
  </Card>;
}
export function BookingBadge({ state }: { state: BookingRecord["state"] }) { return <Badge tone={state === "cancelled" ? "danger" : state === "rescheduled" ? "warning" : "success"}>{state}</Badge>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[13px] font-[650] text-muted">{label}</dt><dd className="mt-1 break-words text-[15px] text-ink">{value}</dd></div>; }
