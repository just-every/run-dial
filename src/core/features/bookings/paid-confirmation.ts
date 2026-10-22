import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { PaymentsService, PendingMoney, Quote } from "../payments";
import { paymentMailFacts, type PaymentMailFacts } from "./money-presentation";
import type { BookingsRepository } from "./repository";
import type { BookingClaim, BookingEmail } from "./types";

export type PaymentStep = { checkoutUrl: string; returnUrl: string; amountCents: number; currency: "usd"; expiresAt: string; mode: "payment" | "setup" };
export type PaidConfirmationResult = { kind: "payment_required"; payment: PaymentStep } | { kind: "payments_unavailable"; reason: string } | { kind: "slot_taken" | "blocked" };

/** PAY-001: a paid event holds the slot through the BOOK-002 claim, then sends the invitee to Stripe Checkout.
 * PAY-003: the hold carries what the invitee was shown (price, deposit, balance, policy) and their card consent,
 * and Checkout charges only the amount due now, or only saves the consented card. Nothing confirms here; only
 * Stripe's signed event converts the hold into the booking. */
export async function beginPaidConfirmation(deps: { repository: BookingsRepository; payments: PaymentsService; runtime: RuntimeEnvironment; confirmationEmails(manageToken: string, payment: PaymentMailFacts): Promise<BookingEmail[]> }, input: {
  claim: Omit<BookingClaim, "manageTokenHash" | "emails">; nonce: string; handle: string; slug: string; quote: Quote; durationMinutes: number; consent?: { version: string };
}): Promise<PaidConfirmationResult> {
  const { payments, runtime } = deps, { quote } = input;
  const returnToken = await payments.returnToken(input.nonce), manageToken = await payments.manageToken(returnToken);
  const balanceSalt = quote.snapshot.balanceCents > 0 ? createOpaqueToken() : undefined;
  const money: PendingMoney = { snapshot: quote.snapshot, ...(input.consent ? { consent: { version: input.consent.version, acceptedAt: input.claim.now } } : {}), ...(balanceSalt ? { balanceSalt } : {}) };
  const claim: BookingClaim = { ...input.claim, manageTokenHash: await hashToken(manageToken, runtime.SESSION_SECRET), emails: [], money };
  const holdId = createId(), timing = payments.holdTiming(Date.parse(input.claim.now));
  const outcome = await deps.repository.claimPaymentHold(claim, { id: holdId, kind: quote.mode, accountId: quote.accountId, amountCents: quote.amountCents, returnTokenHash: await payments.hashReturnToken(returnToken), ...timing });
  if (outcome !== "claimed") return { kind: outcome };
  const returnUrl = returnPageUrl(runtime, input.handle, input.slug, returnToken);
  let session;
  try {
    session = await payments.openCheckout({ holdId, quote, eventTitle: claim.event.title, durationMinutes: input.durationMinutes, returnUrl, customerEmail: claim.invitee.email });
  } catch {
    await payments.releaseHold(holdId, "checkout_unavailable");
    return { kind: "payments_unavailable", reason: "stripe_unavailable" };
  }
  const balanceUrl = balanceSalt ? new URL(`/manage/balance/${await payments.money.balanceToken(balanceSalt)}`, runtime.APP_URL).toString() : undefined;
  const facts = paymentMailFacts({ amountCents: quote.amountCents, reference: session.id, snapshot: quote.snapshot, ...(balanceUrl ? { balanceUrl } : {}) }, claim.selection.startAt);
  await payments.attachCheckout(holdId, session, { ...claim, emails: await deps.confirmationEmails(manageToken, facts) });
  return { kind: "payment_required", payment: { checkoutUrl: session.url!, returnUrl, amountCents: quote.amountCents, currency: "usd", expiresAt: timing.expiresAt, mode: quote.mode } };
}

/** A replayed confirmation before Stripe's event returns the same pending payment; a released hold is over. */
export async function paidReplay(payments: PaymentsService, runtime: RuntimeEnvironment, nonceId: string, nonce: string, handle: string, slug: string): Promise<PaidConfirmationResult | { kind: "expired_nonce" } | undefined> {
  const hold = await payments.holdForNonce(nonceId);
  if (!hold) return undefined;
  if (hold.state === "released" || hold.state === "unbookable") return { kind: "expired_nonce" };
  const returnUrl = returnPageUrl(runtime, handle, slug, await payments.returnToken(nonce));
  return hold.checkoutUrl ? { kind: "payment_required", payment: { checkoutUrl: hold.checkoutUrl, returnUrl, amountCents: hold.amountCents, currency: "usd", expiresAt: hold.expiresAt, mode: hold.kind } } : { kind: "payments_unavailable", reason: "payment_processing" };
}

function returnPageUrl(runtime: RuntimeEnvironment, handle: string, slug: string, token: string) {
  const url = new URL(`/book/${handle}/${slug}/paid`, runtime.APP_URL);
  url.searchParams.set("return", token);
  return url.toString();
}
