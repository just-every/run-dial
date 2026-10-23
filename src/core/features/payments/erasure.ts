import { closeApprovalSetup } from "./approval-card";
import type { ApprovalPayment } from "./approval-state";
import { StripeApi, StripeApiError } from "./stripe-api";
import { pendingRefundKey, pendingRefundParams } from "./pending-refund";

type ApprovalAudit = Partial<Record<"authorize" | "capture" | "void" | "detach" | "refund", string>>;

export type PendingPaymentCleanup = {
  holdId: string; accountId: string; customerId: string | null; savedCard: "detached" | "not_saved" | "failed";
  paymentIntentId: string | null; paymentMethodId: string | null; amountCents: number; refundId: string | null;
  approval?: boolean; audit?: ApprovalAudit; voidedIntentId?: string; authorizedCents?: number;
};
type PendingHold = { id: string; accountId: string; sessionId: string | null; claimJson: string };

/** Erasure closes Checkout before dropping the claim. A paid Checkout is refunded without ever converting it
 * into a booking. An unresolved processor outcome preserves the hold and erasure lock for an explicit retry. */
export async function erasePendingPayments(db: D1Database, email: string, live: () => Promise<{ api: StripeApi; accountId: string } | { refusal: string }>, detach?: (accountId:string,card:string)=>Promise<boolean>): Promise<PendingPaymentCleanup[]> {
  const holds = (await db.prepare("SELECT id,account_id AS accountId,checkout_session_id AS sessionId,claim_json AS claimJson FROM payment_holds WHERE invitee_email_folded=? AND state IN ('held','processing') ORDER BY id").bind(email).all<PendingHold>()).results;
  if (!holds.length) return [];
  const connection = await live();
  if ("refusal" in connection) throw new Error(`payment_erasure_${connection.refusal}`);
  const outcomes: PendingPaymentCleanup[] = [];
  for (const hold of holds) {
    if (hold.accountId !== connection.accountId) throw new Error("payment_erasure_account_changed");
    const outcome: PendingPaymentCleanup = { holdId: hold.id, accountId: hold.accountId, customerId: null, savedCard: "not_saved", paymentIntentId: null, paymentMethodId: null, amountCents: 0, refundId: null };
    const claim = JSON.parse(hold.claimJson) as { bookingId: string; money?: { approval?: unknown } };
    if (claim.money?.approval) {
      outcome.approval = true;
      const request = await db.prepare("SELECT payment_json FROM booking_approval_requests WHERE booking_id=?").bind(claim.bookingId).first<{ payment_json: string | null }>();
      if (request?.payment_json) {
        const payment=JSON.parse(request.payment_json) as ApprovalPayment;
        outcome.audit=payment.audit;
        if(payment.saveCard)await closeApprovalSetup(connection.api,payment);
      }
    }
    // Creation can have reached Stripe before Dial attached its response. Reconcile that attempt before erasing.
    if (!hold.sessionId) throw new Error("payment_erasure_checkout_unresolved");
    let session;
    try { session = await connection.api.expireCheckoutSession(hold.accountId, hold.sessionId); }
    catch (error) {
      if (!(error instanceof StripeApiError) || error.status !== 400) throw error;
      session = await connection.api.getCheckoutSession(hold.accountId, hold.sessionId);
    }
    if (session.status === "open") throw new Error("payment_erasure_checkout_open");
    if (session.status === "complete") {
      outcome.customerId = session.customer ?? null;
      let card: string | null = null;
      if (session.mode === "setup" && session.setup_intent) {
        const setup = await connection.api.getSetupIntent(hold.accountId, session.setup_intent);
        if (setup.status !== "succeeded") throw new Error("payment_erasure_setup_unresolved");
        card = setup.payment_method; outcome.customerId ??= setup.customer;
      } else if (session.payment_intent) {
        const intent = await connection.api.getPaymentIntent(hold.accountId, session.payment_intent);
        if (intent.currency !== "usd") throw new Error("payment_erasure_currency_changed");
        outcome.paymentIntentId = intent.id;
        if (intent.capture_method === "manual") outcome.authorizedCents = intent.amount;
        if (intent.status === "requires_capture" && intent.capture_method === "manual" && intent.amount_received === 0) {
          const voided = await connection.api.cancelPaymentIntent(hold.accountId, intent.id, `dial-approval-void-${hold.id}`);
          if (voided.status !== "canceled" || voided.amount_received !== 0 || voided.amount_capturable !== 0) throw new Error("payment_erasure_void_unresolved");
          outcome.voidedIntentId = intent.id;
        } else if (intent.status === "canceled" && intent.amount_received === 0) {
          if (intent.capture_method === "manual") outcome.voidedIntentId = intent.id;
        } else if (intent.status === "succeeded" && Number.isInteger(intent.amount_received) && intent.amount_received > 0) {
          outcome.amountCents = intent.amount_received;
          const refund = await connection.api.createRefund(hold.accountId, pendingRefundParams(intent.id, outcome.amountCents), pendingRefundKey(hold.id));
          if (refund.status !== "succeeded" || refund.amount !== outcome.amountCents || refund.payment_intent !== intent.id) throw new Error("payment_erasure_refund_unresolved");
          outcome.refundId = refund.id;
        } else throw new Error("payment_erasure_capture_unresolved");
        outcome.customerId ??= intent.customer;
        if (intent.customer) card = intent.payment_method;
      } else throw new Error("payment_erasure_payment_processing");
      if (card) {
        if(detach)outcome.savedCard=await detach(hold.accountId,card)?"detached":"failed";
        else {
          try { await connection.api.detachPaymentMethod(hold.accountId, card); }
          catch (error) { if (!(error instanceof StripeApiError) || error.status !== 400 || !["resource_missing", "payment_method_unexpected_state"].includes(error.code)) throw error; }
          outcome.savedCard = "detached";
        }
        outcome.paymentMethodId = card;
      }
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
