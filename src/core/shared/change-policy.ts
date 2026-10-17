import { z } from "zod";
import { bookingPolicyIntegerSchema, eventBookingPolicySchema, type EventBookingPolicy } from "./booking-policy";

export const changePolicySchema = eventBookingPolicySchema.omit({ lockedTimezone: true });
export type ChangePolicy = z.infer<typeof changePolicySchema>;

export const inheritedChangePolicyWindowsSchema = z.object({
  rescheduleCutoffMinutes: bookingPolicyIntegerSchema,
  cancellationCutoffMinutes: bookingPolicyIntegerSchema,
}).strict();
export type InheritedChangePolicyWindows = z.infer<typeof inheritedChangePolicyWindowsSchema>;
export const defaultInheritedChangePolicyWindows: Readonly<InheritedChangePolicyWindows> = Object.freeze({
  rescheduleCutoffMinutes: 0,
  cancellationCutoffMinutes: 0,
});

export type ChangePolicyReason = "reschedule_cutoff" | "cancellation_cutoff" | "reschedule_limit";
export type ChangePolicyDecision = {
  rescheduleAllowed: boolean;
  cancellationAllowed: boolean;
  rescheduleReason: Exclude<ChangePolicyReason, "cancellation_cutoff"> | null;
  cancellationReason: "cancellation_cutoff" | null;
  rescheduleCutoffAt: string;
  cancellationCutoffAt: string;
  effectivePolicy: InheritedChangePolicyWindows & Pick<ChangePolicy, "maxInviteeReschedules">;
};

/**
 * BOOK-015 invitee policy. Cutoffs use the current occurrence's start; equality
 * blocks the change. Operators and BOOK-014 requests bypass this in the caller.
 * Mutations must also use the repository's atomic SQL predicate.
 */
export function evaluateChangePolicy(input: {
  policy?: ChangePolicy | EventBookingPolicy | null;
  startAt: string;
  now: Date | string;
  successfulInviteeReschedules: number;
  inherited: InheritedChangePolicyWindows;
}): ChangePolicyDecision {
  const policy = eventBookingPolicySchema.parse(input.policy ?? {});
  const inherited = inheritedChangePolicyWindowsSchema.parse(input.inherited);
  const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(input.successfulInviteeReschedules);
  const start = Date.parse(input.startAt);
  const now = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  if (!Number.isFinite(start) || !Number.isFinite(now)) throw new TypeError("Change policy requires valid booking and current instants.");

  const effectivePolicy = {
    rescheduleCutoffMinutes: policy.rescheduleCutoffMinutes ?? inherited.rescheduleCutoffMinutes,
    cancellationCutoffMinutes: policy.cancellationCutoffMinutes ?? inherited.cancellationCutoffMinutes,
    maxInviteeReschedules: policy.maxInviteeReschedules,
  };
  const rescheduleCutoff = start - effectivePolicy.rescheduleCutoffMinutes * 60_000;
  const cancellationCutoff = start - effectivePolicy.cancellationCutoffMinutes * 60_000;
  const rescheduleReason = now >= rescheduleCutoff ? "reschedule_cutoff" :
    policy.maxInviteeReschedules !== null && count >= policy.maxInviteeReschedules ? "reschedule_limit" : null;
  const cancellationReason = now >= cancellationCutoff ? "cancellation_cutoff" : null;
  return {
    rescheduleAllowed: rescheduleReason === null,
    cancellationAllowed: cancellationReason === null,
    rescheduleReason,
    cancellationReason,
    rescheduleCutoffAt: new Date(rescheduleCutoff).toISOString(),
    cancellationCutoffAt: new Date(cancellationCutoff).toISOString(),
    effectivePolicy,
  };
}
