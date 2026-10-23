import { createId, nowIso } from "../../shared/ids";

export type ApprovalPayment = {
  holdId: string; mode: "payment" | "setup"; amountCents: number; accountId: string;
  paymentIntentId: string | null; setupIntentId: string | null; customerId: string | null; paymentMethodId: string | null;
  saveCard?: boolean; consentVersion?: string; setupRefused?: boolean; setupExpiresAt?: string;
  state: "setup_pending" | "authorized" | "capture_pending" | "void_pending" | "captured" | "voided" | "refund_pending" | "refunded";
  authorizedAt: string; actorId?: string | null; captureActorId?: string | null;
  voidState?: "declined" | "expired"; voidReason?: string; capturedCents?: number; refundId?: string; lastError?: string;
  audit: { authorize: string; capture: string; void: string; detach: string; refund: string };
};
export type StripeEvent = { created?: number; id: string; type: string; account?: string; data: { object: Record<string, unknown> } };
export function approvalPayment(json: string | null): ApprovalPayment | undefined { return json ? JSON.parse(json) as ApprovalPayment : undefined; }
export function approvalAuditIds(): ApprovalPayment["audit"] { return { authorize: createId(), capture: createId(), void: createId(), detach: createId(), refund: createId() }; }
export function publicApprovalPayment(payment: ApprovalPayment | undefined) {
  if (!payment) return undefined;
  return { mode: payment.mode, saveCard: Boolean(payment.saveCard), amountCents: payment.amountCents, state: payment.state, ...(payment.capturedCents === undefined ? {} : {capturedCents:payment.capturedCents}), refundedCents: payment.state === "refunded" ? payment.capturedCents : 0 };
}
/** Anonymous processor facts have durable IDs on the command, so recovery and erasure record each once. */
export function approvalAudit(db: D1Database, payment: ApprovalPayment, action: keyof ApprovalPayment["audit"], condition = { sql: "1", params: [] as unknown[] }) {
  const now = nowIso();
  const names = { authorize: "authorization", capture: "capture", void: "void", detach: "saved_card_detach", refund: "refund" };
  const reasons = { authorize: "Approval authorization accepted", capture: "Host approved capture", void: "Approval authorization closed", detach: "Approval saved card detached", refund: "Captured approval could not proceed" };
  const actor = action === "authorize" ? null : action === "capture" ? payment.captureActorId ?? payment.actorId ?? null : payment.actorId ?? null;
  const ref = action === "detach" ? payment.paymentMethodId : action === "refund" ? payment.refundId : payment.paymentIntentId ?? payment.setupIntentId;
  return db.prepare(`INSERT INTO anonymized_audit(id,entity_kind,action,actor_type,actor_id,happened_at,erased_at,amount_cents,processor_ref,reason) SELECT ?,'payment',?,?,?,?,?,?,?,? WHERE ${condition.sql} ON CONFLICT(id) DO NOTHING`)
    .bind(payment.audit[action], names[action], action === "authorize" ? "invitee" : actor ? "operator" : "system", actor, now, now, action === "detach" ? 0 : action === "capture" || action === "refund" ? payment.capturedCents ?? payment.amountCents : payment.amountCents, ref, reasons[action], ...condition.params);
}
