import { Link } from "@tanstack/react-router";
import { Card, buttonClassName } from "../../../app/ui/primitives";
import { BookingBadge, timeRange } from "../../bookings/client";
import type { ClientHistory } from "../types";

export function ClientHistoryView({ history, timezone }: { history: ClientHistory; timezone: string }) {
  return <Card className="min-w-0 p-5 sm:p-6">
    <h2 className="break-words text-xl font-bold">{history.name || history.email}</h2>
    <p className="mt-2 break-all text-sm text-muted">{history.name ? `${history.email} · ` : ""}{history.totalCount} booking{history.totalCount === 1 ? "" : "s"} · Times in {timezone}</p>
    <ol className="mt-5 grid gap-5" aria-label="Client bookings">
      {history.bookings.map(booking => <li key={booking.id} data-client-booking={booking.id} className="min-w-0 border-t border-line-soft pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-bold">{booking.eventTitle}</h3><p className="mt-1 break-words text-sm">{booking.name}</p></div><BookingBadge state={booking.state} /></div>
        <p className="mt-3 text-sm text-soft">{timeRange(booking.startAt, booking.endAt, timezone)}</p>
        <dl className="mt-3 grid gap-3 text-sm">
          <div><dt className="font-semibold">Attendance</dt><dd className="whitespace-pre-wrap break-words">{booking.attendance ? `${booking.attendance.status === "attended" ? "Attended" : "No-show"}${booking.attendance.note ? ` · ${booking.attendance.note}` : ""}` : "Not marked"}</dd></div>
          <div><dt className="font-semibold">Payment</dt><dd>{booking.payment ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: booking.payment.currency }).format(booking.payment.amountCents / 100)} paid${booking.payment.kind === "deposit" ? " as deposit" : ""}` : "No payment recorded"}</dd></div>
          {booking.answers.map(answer => <div key={answer.key}><dt className="font-semibold">{answer.label}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value}</dd></div>)}
          {(booking.customFields ?? []).filter(field => field.value !== null).map(field => <div key={field.id}><dt className="font-semibold">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{typeof field.value === "boolean" ? field.value ? "Yes" : "No" : field.value}</dd></div>)}
        </dl>
        <Link to="/app/bookings" search={() => ({ view: "clients", client: history.email, record: booking.id })} className={buttonClassName("secondary", "mt-4")}>Open booking record</Link>
      </li>)}
    </ol>
    {!history.bookings.length ? <p className="mt-4 text-sm text-muted">No bookings remain for this address.</p> : null}
  </Card>;
}
