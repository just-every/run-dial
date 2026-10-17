import { Badge } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";
import { startTime } from "./operator-time";

export function RescheduleRequestSummary({ booking }: { booking: BookingRecord }) {
  const request = booking.rescheduleRequest;
  if (!request) return null;
  return <section aria-label="Reschedule request" className="mt-5 grid min-w-0 gap-3 rounded-xl border border-line bg-row p-4 text-sm">
    <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">Reschedule request</h3><Badge tone={!request.archiveHistorical && request.state === "open" ? "warning" : "neutral"}>{request.archiveHistorical ? "Historical request" : request.state}</Badge></div>
    {request.message ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{request.message}</p> : <p className="text-soft">No message included.</p>}
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Fact label="Original time choice">{request.releaseTime ? "Released immediately" : "Held until a new time is picked"}</Fact>
      <Fact label="Sent">{startTime(request.createdAt, booking.hostTimezone)}</Fact>
      <Fact label="Request expiry">{startTime(request.expiresAt, booking.hostTimezone)}</Fact>
      <Fact label="Reminder">{request.remindedAt ? `Queued ${startTime(request.remindedAt, booking.hostTimezone)}` : request.reminderAt ? `${!request.archiveHistorical && request.state === "open" ? "Scheduled for" : "Was scheduled for"} ${startTime(request.reminderAt, booking.hostTimezone)}` : "Off"}</Fact>
    </dl>
    {!request.archiveHistorical && request.state === "open" ? <p className="leading-6 text-soft">{request.releaseTime ? "The original time is available to others. If the invitee does not pick before expiry, the booking will be cancelled." : "The original time remains reserved. If the request expires, the original booking remains."}</p> : null}
  </section>;
}

function Fact({ label, children }: { label: string; children: string }) {
  return <div className="min-w-0"><dt className="font-semibold text-muted">{label}</dt><dd className="mt-1 break-words">{children}</dd></div>;
}
