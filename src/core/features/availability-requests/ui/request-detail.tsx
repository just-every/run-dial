import { ExtensionSlot } from "../../../app/extensions";
import { Badge, Button, Card, buttonClassName } from "../../../app/ui/primitives";
import { operatorTimestamp } from "../../../shared/operator-format";

export type RequestState = "submitted" | "handled" | "closed";
export type AvailabilityRequest = { id: string; eventTitle: string; inviteeName: string; inviteeEmail: string; inviteeTimezone: string; note: string | null; state: RequestState; bookingId: string | null; submittedAt: string; windows: Array<{ inviteeLabel: string; hostLabel: string }> };

export function RequestDetail({ request, onTransition, onErase, working, hostTimezone }: { hostTimezone?: string; working: boolean; request: AvailabilityRequest; onTransition: (id: string, state: "handled" | "closed") => Promise<void>; onErase: (id: string) => Promise<void> }) {
  const differentTimezone = hostTimezone && request.inviteeTimezone !== hostTimezone;
  return <Card className="min-w-0 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 break-words"><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">{request.eventTitle}</p><h2 className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-[-.02em] text-ink">{request.inviteeName}</h2><p className="mt-2 text-[15px] text-soft">{request.inviteeEmail}</p></div>
      <RequestStateBadge state={request.state} />
    </div>
    <dl className="mt-6 grid gap-4 border-y border-line-soft py-5 text-[15px]">
      <div><dt className="text-[13px] font-[650] text-muted">Submitted</dt><dd className="mt-1 text-ink">{hostTimezone ? operatorTimestamp(request.submittedAt, hostTimezone) : "Set up the host profile to see the submitted time in the host zone."}</dd></div>
      <div><dt className="text-[13px] font-[650] text-muted">Requested windows</dt><dd className="mt-2">
        {differentTimezone ? <p className="mb-3 text-sm text-muted">Invitee times in {request.inviteeTimezone}</p> : null}
        <div className="grid gap-3">{request.windows.map((window, index) => <div className="rounded-2xl bg-row px-4 py-3.5" key={`${window.inviteeLabel}-${index}`}>
          <strong className="block font-[650] text-ink">{window.hostLabel}</strong>
          {differentTimezone ? <span className="mt-1 block text-sm text-muted">Invitee: {window.inviteeLabel}</span> : null}
        </div>)}</div>
      </dd></div>
      {request.note ? <div><dt className="text-[13px] font-[650] text-muted">Note</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{request.note}</dd></div> : null}
    </dl>
    <ExtensionSlot id="availability-request.detail.after.v1" entityId={request.id} />
    <div className="mt-6 flex flex-wrap items-start gap-3">
      {request.state === "submitted" ? <a className={buttonClassName()} href={`/app/bookings/new?requestId=${encodeURIComponent(request.id)}`}>Create agreed booking</a> : <p className="self-center text-sm font-semibold text-muted">{request.state === "handled" ? "This request has been handled." : "This request has been closed."}</p>}
      <details className="dial-more">
        <summary className={buttonClassName("secondary", "cursor-pointer")}>More</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {request.state === "submitted" ? <><Button type="button" variant="secondary" disabled={working} onClick={() => void onTransition(request.id, "handled")}>Mark handled</Button><Button type="button" variant="secondary" disabled={working} onClick={() => void onTransition(request.id, "closed")}>Close request</Button></> : null}
          <Button type="button" variant="quiet" disabled={working} onClick={() => void onErase(request.id)}>Erase request data</Button>
        </div>
      </details>
    </div>
  </Card>;
}

export function RequestStateBadge({ state }: { state: RequestState }) { return state === "submitted" ? null : <Badge>{state}</Badge>; }
