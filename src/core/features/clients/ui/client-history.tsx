import { buttonClassName, PlainLink } from "../../../app/ui/primitives";
import { recordTrail, rememberRow, useReturnFocus } from "../../../app/ui/record-layout";
import { BookingBadge, timeRange } from "../../bookings/client";
import type { ClientHistory } from "../types";

/** A client as its own page: the name is the page's one title over the client's bookings, each a hairline apart (DW8). */
export function ClientHistoryView({ history, timezone }: { history: ClientHistory; timezone: string }) {
  // A booking opens at its own path, its index that client's bookings, under "‹ <client name>" back to here.
  const client = `/app/clients/${encodeURIComponent(history.email)}`;
  useReturnFocus(client, false);
  return <article className="min-w-0">
    <h1 className="break-words text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] text-ink sm:text-[40px]">{history.name || history.email}</h1>
    <p className="mt-3 break-words text-sm text-muted">{history.name ? `${history.email} · ` : ""}{history.totalCount} booking{history.totalCount === 1 ? "" : "s"} · Times in {timezone}</p>
    <h2 className="mt-7 border-t border-line-soft pt-6 text-xs font-bold uppercase tracking-[.12em] text-muted">Client bookings</h2>
    <ol className="mt-1 grid" aria-label="Client bookings">
      {history.bookings.map(booking => <li key={booking.id} data-client-booking={booking.id} className="min-w-0 border-t border-line-soft py-5 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-bold">{booking.eventTitle}</h3><p className="mt-1 break-words text-sm">{booking.name}</p></div><BookingBadge state={booking.state} /></div>
        <p className="mt-3 text-sm text-soft">{timeRange(booking.startAt, booking.endAt, timezone)}</p>
        <dl className="mt-3 grid gap-3 text-sm">
          <div><dt className="font-semibold">Attendance</dt><dd className="whitespace-pre-wrap break-words">{booking.attendance ? `${booking.attendance.status === "attended" ? "Attended" : "No-show"}${booking.attendance.note ? ` · ${booking.attendance.note}` : ""}` : "Not marked"}</dd></div>
          <div><dt className="font-semibold">Payment</dt><dd>{booking.payment ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: booking.payment.currency }).format(booking.payment.amountCents / 100)} paid${booking.payment.kind === "deposit" ? " as deposit" : ""}` : "No payment recorded"}</dd></div>
          {booking.answers.map(answer => <div key={answer.key}><dt className="font-semibold">{answer.label}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value}</dd></div>)}
          {(booking.customFields ?? []).filter(field => field.value !== null).map(field => <div key={field.id}><dt className="font-semibold">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{typeof field.value === "boolean" ? field.value ? "Yes" : "No" : field.value}</dd></div>)}
        </dl>
        <PlainLink to="/app/bookings/$id" params={{ id: booking.id }} search={() => ({ query: history.email, client: history.email })} state={recordTrail(client)} onClick={() => rememberRow(client, booking.id)} data-record-row={booking.id} className={buttonClassName("secondary", "mt-4")}>Open booking record</PlainLink>
      </li>)}
    </ol>
    {!history.bookings.length ? <p className="mt-4 text-sm text-muted">No bookings remain for this address.</p> : null}
  </article>;
}
