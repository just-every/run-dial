import { formatZonedTime } from "../../../shared/timezone-lock";
import { format } from "./flow-shell";
import type { Confirmation } from "./types";

export function ManageRescheduleRequest({ booking, timezone }: { booking: Confirmation; timezone: string }) {
  const request = booking.rescheduleRequest;
  if (!request || request.archiveHistorical || (request.state !== "open" && request.state !== "expired")) return null;
  return <section className="pb-change-terms" aria-label="Host reschedule request">
    <h2>{request.state === "open" ? "Your host has asked you to pick a new time" : "The request to pick a new time has expired"}</h2>
    {request.message ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{request.message}</p> : null}
    {request.state === "open" ? <><p>{request.releaseTime ? "Your original time has been released and is available to others." : "Your original time is held until you confirm a new time."}</p><p>Choose a new time by {booking.lockedTimezone ? formatZonedTime(request.expiresAt, timezone) : format(request.expiresAt, timezone)}. {request.releaseTime ? "If you do not pick before then, this booking will be cancelled." : "If you do not pick before then, your original booking remains."}</p><p>This invitation lets you pick a new time even if the usual reschedule cut-off or limit has been reached.</p></> : <p>{request.releaseTime ? "The original time was released. No new time was picked before expiry, so this booking has been cancelled." : "Your original booking remains at its reserved time."}</p>}
  </section>;
}
