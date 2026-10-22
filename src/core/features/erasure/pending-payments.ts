import { ErasureError } from "../../../modules/erasure/index.mjs";
import { createId, nowIso } from "../../shared/ids";
import type { SessionRecord } from "../operators";
import { deleteRows } from "./address";
import { erasureAuthority } from "./admission";
import { erasurePortability } from "./portability";
import type { ErasureStatement } from "./booking-statements";

export type PendingPaymentCleanup = {
  holdId: string; customerId: string | null; savedCard: "detached" | "not_saved";
  paymentIntentId: string | null; paymentMethodId: string | null; amountCents: number; refundId: string | null;
};
export type CleanupPendingPayments = (email: string) => Promise<PendingPaymentCleanup[]>;

/** Remote effects finish before deleting their authority. Stable provider keys make a failed local commit
 * safely resumable; receipt counts, anonymous accounting, nonce retirement and hold deletion commit together. */
export async function erasePendingPayments(db: D1Database, email: string, session: SessionRecord, cleanup?: CleanupPendingPayments) {
  const holds = (await db.prepare("SELECT id, nonce_id, checkout_session_id FROM payment_holds WHERE invitee_email_folded=? ORDER BY id").bind(email).all<{ id: string; nonce_id: string; checkout_session_id: string | null }>()).results;
  if (!holds.length) return;
  if (!cleanup) throw new ErasureError("payment_erasure_unavailable", 503);
  const fence = await erasurePortability(db);
  const outcomes = await cleanup(email);
  if (JSON.stringify(outcomes.map(outcome => outcome.holdId).sort()) !== JSON.stringify(holds.map(hold => hold.id))) throw new ErasureError("payment_erasure_incomplete", 503);
  const statements: ErasureStatement[] = [erasureAuthority(session), {
    sql: `SELECT CASE WHEN (SELECT json_group_array(id) FROM (SELECT id FROM payment_holds WHERE invitee_email_folded=? ORDER BY id))=? THEN 1 ELSE abs(-9223372036854775808) END`,
    params: [email, JSON.stringify(holds.map(hold => hold.id))],
  }, {
    sql: `UPDATE person_erasure_receipts SET stripe_customers_retained=COALESCE(stripe_customers_retained,0)+?, stripe_sessions_retained=COALESCE(stripe_sessions_retained,0)+?, saved_cards_detached=COALESCE(saved_cards_detached,0)+?
      WHERE id=(SELECT receipt_id FROM person_erasure_locks WHERE email=?)`,
    params: [new Set(outcomes.map(outcome => outcome.customerId).filter(Boolean)).size, holds.filter(hold => hold.checkout_session_id).length, outcomes.filter(outcome => outcome.savedCard === "detached").length, email],
  }];
  const now = nowIso();
  for (const outcome of outcomes) {
    const facts: Array<[string, string, number | null, string | null]> = [];
    if (outcome.paymentIntentId && outcome.refundId) facts.push(["payment", "invitee", outcome.amountCents, outcome.paymentIntentId], ["refund:succeeded", "policy", outcome.amountCents, outcome.refundId]);
    if (outcome.savedCard === "detached") facts.push(["saved_card_detached", "operator", 0, outcome.paymentMethodId]);
    for (const [action, actor, amount, reference] of facts) statements.push({
      sql: "INSERT INTO anonymized_audit(id,entity_kind,action,actor_type,actor_id,happened_at,erased_at,amount_cents,processor_ref,reason) VALUES(?,'payment',?,?,?,?,?,?,?,'Person erasure before payment confirmation')",
      params: [createId(), action, action === "payment" ? actor : "operator", action === "payment" ? null : session.id, now, now, amount, reference],
    });
  }
  const ids = JSON.stringify(holds.map(hold => hold.id));
  statements.push(...await deleteRows(db, fence, "booking_nonces", "id IN (SELECT nonce_id FROM payment_holds WHERE id IN (SELECT value FROM json_each(?)))", [ids]));
  statements.push(...await deleteRows(db, fence, "payment_holds", "id IN (SELECT value FROM json_each(?))", [ids]), erasureAuthority(session));
  await db.batch(statements.map(statement => db.prepare(statement.sql).bind(...statement.params)));
}
