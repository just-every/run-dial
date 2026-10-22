import type { MoneyRefusal } from "./money-service";
import type { Movement, MovementsRepository } from "./movements-repository";
import { StripeApi, StripeApiError } from "./stripe-api";

type Live = { accountId: string; api: StripeApi } | { refusal: MoneyRefusal };

/** D4: after a cancellation commits, its open invoice is voided and its open balance Checkout expired at Stripe, so
 * neither can be paid. One that never reached Stripe is simply closed. Without a live connection, or on a lost
 * response, the movement stays `void_pending` for the sweep; a payment Stripe took before the void is refunded on
 * its signed event. */
export async function voidAtStripe(movements: MovementsRepository, pending: Movement[], live: Live) {
  await Promise.all(pending.map(async movement => {
    const target = movement.kind === "invoice" ? movement.invoiceId : movement.checkoutSessionId;
    if (!target) {
      // No invoice identity is not proof that Stripe has no invoice (a creation response may have been lost).
      if (movement.kind !== "invoice") await movements.markVoid(movement.id, "voided");
      return;
    }
    if ("refusal" in live || live.accountId !== movement.accountId) return;
    try {
      if (movement.kind === "invoice") await live.api.voidInvoice(movement.accountId, target, `dial-invoice-${movement.id}-void`);
      else await live.api.expireCheckoutSession(movement.accountId, target);
      await movements.markVoid(movement.id, "voided");
    } catch (error) {
      if (error instanceof StripeApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429) await movements.markVoid(movement.id, "void_refused");
    }
  }));
}
