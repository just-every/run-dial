import type { ChangePolicyDecision } from "../../../shared/change-policy";
import { formatZonedTime } from "../../../shared/timezone-lock";
import type { PublicBookingPolicy } from "./types";

type Terms = Pick<PublicBookingPolicy, "rescheduleCutoffMinutes" | "cancellationCutoffMinutes" | "maxInviteeReschedules">;

export function BookingChangeTerms({ policy }: { policy?: Terms }) {
  if (!policy) return null;
  const cutoff = (minutes: number | null) => !minutes ? "until the booking starts" : `until ${duration(minutes)} before the start`;
  return <section className="pb-change-terms" aria-label="Booking change policy"><h2>Changing your booking</h2><p>You can reschedule {cutoff(policy.rescheduleCutoffMinutes)} and cancel {cutoff(policy.cancellationCutoffMinutes)}.</p>{policy.maxInviteeReschedules !== null ? <p>{policy.maxInviteeReschedules === 0 ? "Invitee rescheduling is not available for this event." : `You can reschedule this booking up to ${policy.maxInviteeReschedules} ${policy.maxInviteeReschedules === 1 ? "time" : "times"}.`}</p> : null}</section>;
}

export function ManageChangeTerms({ decision, timezone }: { decision?: ChangePolicyDecision; timezone: string }) {
  if (!decision) return null;
  return <><BookingChangeTerms policy={decision.effectivePolicy} /><p>Reschedule cut-off: {formatZonedTime(decision.rescheduleCutoffAt, timezone)}.<br />Cancellation cut-off: {formatZonedTime(decision.cancellationCutoffAt, timezone)}.</p>{!decision.rescheduleAllowed ? <p>{decision.rescheduleReason === "reschedule_limit" ? "This booking has reached its invitee reschedule limit." : "The reschedule cut-off has passed."}</p> : null}{!decision.cancellationAllowed ? <p>The cancellation cut-off has passed.</p> : null}</>;
}

function duration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
