import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import type { BookingMoney } from "../core/features/payments/money-service";
import { AccountingFailure } from "../core/features/payments/accounting-types";
import { NoticeFailure } from "../core/features/workspace-notices/types";
import { receiptOperators } from "../core/features/payments/receipts";
import { required, type ClassAndFacts } from "./native-tool";

export const financial = (records: number): ClassAndFacts => ({ class: "sensitive", facts: { measure: records, kind: "financial" } });

/** Base's monetary policy measures are integer minor units, as in its M8 vectors. */
export const moneyAmount = (amountCents: number): ClassAndFacts => ({ class: "money", facts: { measure: amountCents, currency: "USD", counterparty: "known" } });
/** Approval pages print value directly, so display the same amount in dollars. */
export const usdAmount = (amountCents: number) => ({ value: amountCents / 100, currency: "USD" });

export async function paymentBooking(services: AppServices, id: string) {
  return required(await services.bookings.getForOperator(id));
}

/** Capabilities and provider credentials never leave the native payment boundary. */
export function moneyView(money: BookingMoney | undefined) {
  if (!money) return null;
  const payment = money.payment;
  const consent = money.consent;
  return {
    ledger: money.ledger,
    terms: money.snapshot ?? null,
    reconciliation: money.reconciliation,
    payment: payment ? {
      amountCents: payment.amountCents, currency: payment.currency, reference: payment.paymentIntentId,
      paidAt: payment.paidAt, kind: payment.kind, taxCents: payment.taxCents, taxSummary: payment.taxSummary,
    } : null,
    consent: consent ? {
      consentTextVersion: consent.consentTextVersion, acceptedAt: consent.acceptedAt,
      freeWindowHours: consent.freeWindowHours, lateCancelFeeCents: consent.lateCancelFeeCents,
      noShowFeeCents: consent.noShowFeeCents, hasSavedCard: Boolean(consent.paymentMethodId),
    } : null,
    movements: money.movements.map(movement => ({
      id: movement.id, kind: movement.kind, amountCents: movement.amountCents, taxCents: movement.taxCents,
      taxSummary: movement.taxSummary, status: movement.status, actorType: movement.actorType,
      actorId: movement.actorId, reason: movement.reason, reference: movement.processorRef,
      failureCode: movement.failureCode, invoiceId: movement.invoiceId, invoiceNumber: movement.invoiceNumber,
      createdAt: movement.createdAt, updatedAt: movement.updatedAt,
    })),
  };
}

/** Include native booking and money changes; booking.updatedAt alone misses refunds. */
export async function moneyRevision(services: AppServices, id: string) {
  const booking = await paymentBooking(services, id);
  return JSON.stringify([booking.updatedAt, booking.attendance, moneyView(booking.money)]);
}

export async function feeRecipients(services: AppServices, db: D1Database, id: string) {
  const booking = await paymentBooking(services, id);
  return [...new Set([booking.inviteeEmail, ...(await receiptOperators(db)).map(operator => operator.email)])];
}

export async function paymentCommand<T>(command: () => Promise<T>): Promise<T> {
  try { return await command(); }
  catch (error) {
    if (error instanceof AccountingFailure || error instanceof NoticeFailure) throw new ToolRefusal(error.code);
    throw error;
  }
}
