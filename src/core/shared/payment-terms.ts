import { formatUsd } from "./event-price";

/** PAY-003 money terms shared by the Worker and the browser: an event type's deposit and cancellation policy,
 * the snapshot a booking keeps of what the invitee was shown, and the policy and consent wording. */
export type DepositRule = { kind: "none" } | { kind: "fixed"; amountCents: number } | { kind: "percent"; percent: number };
export type PaymentTerms = {
  deposit: DepositRule;
  /** The balance after a deposit is due this many hours before the start. */
  balanceDueHours: number;
  /** Free cancellation until this many hours before the start; null means no cancellation policy. */
  freeWindowHours: number | null;
  lateCancelFeeCents: number;
  noShowFeeCents: number;
  version: number;
};
export const noPaymentTerms: PaymentTerms = { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: null, lateCancelFeeCents: 0, noShowFeeCents: 0, version: 0 };

/** What one booking was shown before it was held: the snapshot never follows later edits of the event's terms. */
export type TermsSnapshot = {
  priceCents: number;
  depositCents: number;
  dueNowCents: number;
  balanceCents: number;
  balanceDueHours: number;
  freeWindowHours: number | null;
  lateCancelFeeCents: number;
  noShowFeeCents: number;
  version: number;
  /** PAY-005: the sales tax Stripe Tax calculated on the whole price, and its jurisdiction summary. */
  taxCents: number;
  taxSummary: string | null;
};

export const cardConsentVersion = "card-consent.v1";

/** The first payment carries the tax in proportion to what it pays of the price; the balance carries the rest. */
export function dueNowTaxCents(snapshot: Pick<TermsSnapshot, "priceCents" | "dueNowCents" | "taxCents">) {
  return snapshot.priceCents > 0 && snapshot.taxCents > 0 ? Math.round(snapshot.taxCents * snapshot.dueNowCents / snapshot.priceCents) : 0;
}
export function balanceTaxCents(snapshot: Pick<TermsSnapshot, "priceCents" | "dueNowCents" | "taxCents">) {
  return snapshot.taxCents - dueNowTaxCents(snapshot);
}

/** A stated fee can only be charged to a card the invitee agreed to save. */
export function cardRequired(terms: Pick<PaymentTerms, "lateCancelFeeCents" | "noShowFeeCents">) {
  return terms.lateCancelFeeCents > 0 || terms.noShowFeeCents > 0;
}

export function termsSnapshot(terms: PaymentTerms, priceCents: number): TermsSnapshot {
  const depositCents = priceCents === 0 || terms.deposit.kind === "none" ? 0
    : terms.deposit.kind === "fixed" ? terms.deposit.amountCents : Math.round(priceCents * terms.deposit.percent / 100);
  const dueNowCents = depositCents || priceCents;
  return { priceCents, depositCents, dueNowCents, balanceCents: priceCents - dueNowCents, balanceDueHours: terms.balanceDueHours, freeWindowHours: terms.freeWindowHours, lateCancelFeeCents: terms.lateCancelFeeCents, noShowFeeCents: terms.noShowFeeCents, version: terms.version, taxCents: 0, taxSummary: null };
}

/** The instant the balance is due and the instant the free cancellation window closes, both from the current start. */
export function balanceDueAt(snapshot: Pick<TermsSnapshot, "balanceCents" | "balanceDueHours">, startAt: string) {
  return snapshot.balanceCents > 0 ? new Date(Date.parse(startAt) - snapshot.balanceDueHours * 3_600_000).toISOString() : null;
}
export function freeWindowEndsAt(snapshot: Pick<TermsSnapshot, "freeWindowHours">, startAt: string) {
  return snapshot.freeWindowHours === null ? null : new Date(Date.parse(startAt) - snapshot.freeWindowHours * 3_600_000).toISOString();
}

/** What an invitee's cancellation at `now` does under the snapshot. A host-side cancellation refunds in full instead (D4). */
export type CancellationOutcome = { kind: "refund" } | { kind: "late_fee"; feeCents: number } | { kind: "none"; reason: "no_policy" | "late_without_fee" };
export function cancellationOutcome(snapshot: Pick<TermsSnapshot, "freeWindowHours" | "lateCancelFeeCents">, startAt: string, now: string): CancellationOutcome {
  const closes = freeWindowEndsAt(snapshot, startAt);
  if (closes === null) return { kind: "none", reason: "no_policy" };
  if (now <= closes) return { kind: "refund" };
  return snapshot.lateCancelFeeCents > 0 ? { kind: "late_fee", feeCents: snapshot.lateCancelFeeCents } : { kind: "none", reason: "late_without_fee" };
}

const hours = (value: number) => `${value} ${value === 1 ? "hour" : "hours"}`;

/** The cancellation policy as stated before booking, in the confirmation and on the manage page. */
export function cancellationPolicyLines(snapshot: Pick<TermsSnapshot, "priceCents" | "freeWindowHours" | "lateCancelFeeCents" | "noShowFeeCents">) {
  const lines: string[] = [];
  if (snapshot.freeWindowHours === null) lines.push(snapshot.priceCents > 0 ? "No cancellation policy: Dial issues no automatic refund and charges no fee when you cancel. The host can still refund you." : "No cancellation policy: cancelling costs nothing.");
  else {
    lines.push(snapshot.priceCents > 0 ? `Cancel at least ${hours(snapshot.freeWindowHours)} before the start and Dial refunds everything you paid, automatically.` : `Cancel at least ${hours(snapshot.freeWindowHours)} before the start at no charge.`);
    const kept = snapshot.priceCents > 0 ? " What you paid is not refunded." : "";
    lines.push(snapshot.lateCancelFeeCents > 0 ? `After that, a late-cancellation fee of ${formatUsd(snapshot.lateCancelFeeCents)} is charged to your saved card.${kept}` : `After that, cancelling costs nothing more.${kept}`);
  }
  if (snapshot.noShowFeeCents > 0) lines.push(`If you do not attend, the host may charge a no-show fee of ${formatUsd(snapshot.noShowFeeCents)} to your saved card.`);
  if (snapshot.priceCents > 0) lines.push("If the host cancels, Dial refunds everything you paid, automatically, and charges no fee.");
  return lines;
}

/** The unchecked consent an invitee gives before a fee-bearing booking, recorded with its version and amounts. */
export function cardConsentText(snapshot: Pick<TermsSnapshot, "freeWindowHours" | "lateCancelFeeCents" | "noShowFeeCents">) {
  const charges = [
    ...(snapshot.lateCancelFeeCents > 0 && snapshot.freeWindowHours !== null ? [`${formatUsd(snapshot.lateCancelFeeCents)} if I cancel later than ${hours(snapshot.freeWindowHours)} before the start`] : []),
    ...(snapshot.noShowFeeCents > 0 ? [`${formatUsd(snapshot.noShowFeeCents)} if I do not attend`] : []),
  ];
  return `I agree that Stripe saves my card for this booking and that it may be charged ${charges.join(", or ")}. No other amount is charged to it.`;
}
