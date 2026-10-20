import { hashToken } from "../../platform/auth/tokens";
import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { PaymentsService } from "../payments";
import type { BookingsRepository } from "./repository";
import type { BookingClaim, BookingEmail } from "./types";

export type PaymentStep = { checkoutUrl: string; returnUrl: string; amountCents: number; currency: "usd"; expiresAt: string };
export type PaidConfirmationResult = { kind: "payment_required"; payment: PaymentStep } | { kind: "payments_unavailable"; reason: string } | { kind: "slot_taken" | "blocked" };
type Quote = { amountCents: number; accountId: string; achEnabled: boolean };

/** PAY-001: a paid event holds the slot through the BOOK-002 claim, then sends the invitee to Stripe Checkout.
 * Nothing confirms here; only Stripe's signed event converts the hold into the booking. */
export async function beginPaidConfirmation(deps: { repository: BookingsRepository; payments: PaymentsService; runtime: RuntimeEnvironment; confirmationEmails(manageToken: string, payment: { amountCents: number; reference: string }): Promise<BookingEmail[]> }, input: {
  claim: Omit<BookingClaim, "manageTokenHash" | "emails">; nonce: string; handle: string; slug: string; quote: Quote; durationMinutes: number;
}): Promise<PaidConfirmationResult> {
  const { payments, runtime } = deps;
  const returnToken = await payments.returnToken(input.nonce), manageToken = await payments.manageToken(returnToken);
  const claim: BookingClaim = { ...input.claim, manageTokenHash: await hashToken(manageToken, runtime.SESSION_SECRET), emails: [] };
  const holdId = createId(), timing = payments.holdTiming(Date.parse(input.claim.now));
  const outcome = await deps.repository.claimPaymentHold(claim, { id: holdId, accountId: input.quote.accountId, amountCents: input.quote.amountCents, returnTokenHash: await payments.hashReturnToken(returnToken), ...timing });
  if (outcome !== "claimed") return { kind: outcome };
  const returnUrl = returnPageUrl(runtime, input.handle, input.slug, returnToken);
  let session;
  try {
    session = await payments.openCheckout({ holdId, accountId: input.quote.accountId, amountCents: input.quote.amountCents, eventTitle: claim.event.title, durationMinutes: input.durationMinutes, returnUrl, customerEmail: claim.invitee.email, achEnabled: input.quote.achEnabled });
  } catch {
    await payments.releaseHold(holdId, "checkout_unavailable");
    return { kind: "payments_unavailable", reason: "stripe_unavailable" };
  }
  await payments.attachCheckout(holdId, session, { ...claim, emails: await deps.confirmationEmails(manageToken, { amountCents: input.quote.amountCents, reference: session.id }) });
  return { kind: "payment_required", payment: { checkoutUrl: session.url!, returnUrl, amountCents: input.quote.amountCents, currency: "usd", expiresAt: timing.expiresAt } };
}

/** A replayed confirmation before Stripe's event returns the same pending payment; a released hold is over. */
export async function paidReplay(payments: PaymentsService, runtime: RuntimeEnvironment, nonceId: string, nonce: string, handle: string, slug: string): Promise<PaidConfirmationResult | { kind: "expired_nonce" } | undefined> {
  const hold = await payments.holdForNonce(nonceId);
  if (!hold) return undefined;
  if (hold.state === "released" || hold.state === "unbookable") return { kind: "expired_nonce" };
  const returnUrl = returnPageUrl(runtime, handle, slug, await payments.returnToken(nonce));
  return hold.checkoutUrl ? { kind: "payment_required", payment: { checkoutUrl: hold.checkoutUrl, returnUrl, amountCents: hold.amountCents, currency: "usd", expiresAt: hold.expiresAt } } : { kind: "payments_unavailable", reason: "payment_processing" };
}

function returnPageUrl(runtime: RuntimeEnvironment, handle: string, slug: string, token: string) {
  const url = new URL(`/book/${handle}/${slug}/paid`, runtime.APP_URL);
  url.searchParams.set("return", token);
  return url.toString();
}
