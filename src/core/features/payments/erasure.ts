import { StripeApi, StripeApiError } from "./stripe-api";

export type PendingPaymentCleanup = {
  holdId: string; customerId: string | null; savedCard: "detached" | "not_saved";
  paymentIntentId: string | null; paymentMethodId: string | null; amountCents: number; refundId: string | null;
};
type PendingHold = { id: string; accountId: string; sessionId: string | null };

/** Erasure closes Checkout before dropping the claim. A paid Checkout is refunded without ever converting it
 * into a booking. An unresolved processor outcome preserves the hold and erasure lock for an explicit retry. */
export async function erasePendingPayments(db: D1Database, email: string, live: () => Promise<{ api: StripeApi; accountId: string } | { refusal: string }>): Promise<PendingPaymentCleanup[]> {
  const holds = (await db.prepare("SELECT id,account_id AS accountId,checkout_session_id AS sessionId FROM payment_holds WHERE invitee_email_folded=? AND state IN ('held','processing') ORDER BY id").bind(email).all<PendingHold>()).results;
  if (!holds.length) return [];
  const connection = await live();
  if ("refusal" in connection) throw new Error(`payment_erasure_${connection.refusal}`);
  const outcomes: PendingPaymentCleanup[] = [];
  for (const hold of holds) {
    if (hold.accountId !== connection.accountId) throw new Error("payment_erasure_account_changed");
    const outcome: PendingPaymentCleanup = { holdId: hold.id, customerId: null, savedCard: "not_saved", paymentIntentId: null, paymentMethodId: null, amountCents: 0, refundId: null };
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
      } else if (session.payment_status === "paid" && session.payment_intent) {
        const intent = await connection.api.getPaymentIntent(hold.accountId, session.payment_intent);
        if (intent.status !== "succeeded" || intent.currency !== "usd") throw new Error("payment_erasure_capture_unresolved");
        outcome.paymentIntentId = intent.id; outcome.amountCents = intent.amount_received ?? intent.amount;
        if (outcome.amountCents > 0) {
          const refund = await connection.api.createRefund(hold.accountId, { payment_intent: intent.id, amount: String(outcome.amountCents) }, `dial-erasure-hold-${hold.id}`);
          if (refund.status !== "succeeded" || refund.amount !== outcome.amountCents || refund.payment_intent !== intent.id) throw new Error("payment_erasure_refund_unresolved");
          outcome.refundId = refund.id;
        }
        outcome.customerId ??= intent.customer;
        if (intent.customer) card = intent.payment_method;
      } else throw new Error("payment_erasure_payment_processing");
      if (card) {
        try { await connection.api.detachPaymentMethod(hold.accountId, card); }
        catch (error) { if (!(error instanceof StripeApiError) || error.status !== 400 || !["resource_missing", "payment_method_unexpected_state"].includes(error.code)) throw error; }
        outcome.savedCard = "detached";
        outcome.paymentMethodId = card;
      }
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
