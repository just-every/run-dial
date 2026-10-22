import { z } from "zod";
import type { EventPrice } from "../../shared/event-price";
import { noPaymentTerms, type PaymentTerms } from "../../shared/payment-terms";
export { cardRequired, noPaymentTerms, termsSnapshot, type PaymentTerms, type TermsSnapshot } from "../../shared/payment-terms";

const cents = z.number().int().min(50).max(99_999_999);
export const paymentTermsInputSchema = z.object({
  deposit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("fixed"), amountCents: cents }).strict(),
    z.object({ kind: z.literal("percent"), percent: z.number().int().min(1).max(99) }).strict(),
  ]),
  balanceDueHours: z.number().int().min(0).max(720),
  freeWindowHours: z.number().int().min(1).max(720).nullable(),
  lateCancelFeeCents: z.union([z.literal(0), cents]),
  noShowFeeCents: z.union([z.literal(0), cents]),
}).strict();
export type PaymentTermsInput = z.infer<typeof paymentTermsInputSchema>;

export type TermsRow = { depositKind: "none" | "fixed" | "percent"; depositValue: number; balanceDueHours: number; freeWindowHours: number | null; lateCancelFeeCents: number; noShowFeeCents: number; version: number };

export function termsFromRow(row: TermsRow | null | undefined): PaymentTerms {
  if (!row) return noPaymentTerms;
  const deposit = row.depositKind === "fixed" ? { kind: "fixed" as const, amountCents: row.depositValue } : row.depositKind === "percent" ? { kind: "percent" as const, percent: row.depositValue } : { kind: "none" as const };
  return { deposit, balanceDueHours: row.balanceDueHours, freeWindowHours: row.freeWindowHours, lateCancelFeeCents: row.lateCancelFeeCents, noShowFeeCents: row.noShowFeeCents, version: row.version };
}

export type TermsRefusal = "deposit_needs_price" | "deposit_too_large" | "deposit_too_small" | "late_fee_needs_window" | "window_inside_cutoff";

/** Every priced option keeps a deposit of at least $0.50 below its price, a late fee follows a free window, and the
 * free window may not end inside the event's cancellation cut-off, where the invitee could no longer cancel. */
export function validateTerms(input: PaymentTermsInput, price: EventPrice, offeredDurations: number[], cancellationCutoffMinutes: number | null): TermsRefusal | undefined {
  const prices = offeredDurations.map(duration => price.durationPrices.find(entry => entry.durationMinutes === duration)?.amountCents ?? price.amountCents).filter((value): value is number => value !== null);
  if (input.deposit.kind !== "none") {
    if (!prices.length || prices.length < offeredDurations.length) return "deposit_needs_price";
    const deposits = prices.map(amount => input.deposit.kind === "fixed" ? input.deposit.amountCents : Math.round(amount * (input.deposit as { percent: number }).percent / 100));
    if (deposits.some((deposit, index) => deposit >= prices[index])) return "deposit_too_large";
    if (deposits.some(deposit => deposit < 50) || prices.some((amount, index) => amount - deposits[index] < 50)) return "deposit_too_small";
  }
  if (input.lateCancelFeeCents > 0 && input.freeWindowHours === null) return "late_fee_needs_window";
  if (input.freeWindowHours !== null && (cancellationCutoffMinutes ?? 0) > input.freeWindowHours * 60) return "window_inside_cutoff";
  return undefined;
}

export const termsRefusalMessages: Record<TermsRefusal, string> = {
  deposit_needs_price: "Price every offered duration before taking a deposit.",
  deposit_too_large: "A deposit must be less than the price of every offered duration.",
  deposit_too_small: "A deposit and the balance after it must each be at least $0.50.",
  late_fee_needs_window: "Set a free cancellation window before stating a late-cancellation fee.",
  window_inside_cutoff: "The free cancellation window must end before the event's cancellation cut-off, or invitees could not cancel inside it.",
};
