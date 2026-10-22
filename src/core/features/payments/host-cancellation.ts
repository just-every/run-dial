import { allocateRefund, type Ledger } from "./ledger";
import type { NewMovement } from "./movements-repository";

/** A host-side cancellation: an operator from the booking record, the host's calendar deletion, or the expiry of the
 * host's reschedule request. Only an operator may refund less than everything, and only with a reason. */
export type HostCancellation = { cause: "operator"; operatorId: string; refund?: { amountCents: number; reason: string } } | { cause: "calendar" | "request_expired" };
export type HostRefundOutcome = { kind: "host_refund"; refundableCents: number; reason?: string };

const causeReasons = {
  operator: "The host cancelled",
  calendar: "The host deleted the booking's calendar event",
  request_expired: "The host's reschedule request expired with no new time",
} as const;

/** PAY-003 (D4): everything captured is refunded, split across the captured payments, with no fee; a smaller refund
 * an operator chose carries its reason. Each part's key makes it once-only. */
export function hostRefund(bookingId: string, summary: Ledger, accountId: string | undefined, by: HostCancellation) {
  const choice = by.cause === "operator" ? by.refund : undefined;
  const refundCents = choice?.amountCents ?? summary.refundableCents;
  if (refundCents > summary.refundableCents) return { kind: "exceeds_refundable" as const, refundableCents: summary.refundableCents };
  const parts = refundCents > 0 && accountId ? allocateRefund(summary.charges, refundCents) ?? [] : [];
  const movements = parts.map((part): NewMovement => ({
    bookingId, kind: "refund", amountCents: part.amountCents, taxCents: part.taxCents,
    actorType: by.cause === "operator" ? "operator" : "policy", actorId: by.cause === "operator" ? by.operatorId : null,
    reason: choice?.reason ?? causeReasons[by.cause], accountId: accountId!, sourceRef: part.ref, idempotencyKey: `host-refund:${bookingId}:${part.ref}`,
  }));
  const outcome: HostRefundOutcome = { kind: "host_refund", refundableCents: summary.refundableCents, ...(choice ? { reason: choice.reason } : {}) };
  return { kind: "plan" as const, outcome, refundCents, movements };
}
