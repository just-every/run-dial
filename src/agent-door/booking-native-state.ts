import type { AppServices } from "../core/app/services";
import type { BookingRecord } from "../core/features/bookings/types";
import { stableJson } from "../core/shared/stable-json";
import { safeBooking } from "./resource-bookings";
import { resourceText } from "./resource-definition";
import { external, live, required, standard, type ClassAndFacts, type ToolContext } from "./native-tool";

/** A digest of native state for approval freshness, not a native integer revision. */
export async function stateDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export const bookingReadClass = (records = 1): ClassAndFacts[] => [{ class: "sensitive", facts: { measure: records, kind: "booking_records" } }];
export const moneyClass = (cents: number): ClassAndFacts => ({ class: "money", facts: { measure: cents, currency: "USD", counterparty: "known" } });

/** Native candidate recipients; delivery still rechecks authority, mute and suppression. */
export async function hostRecipients(ctx: ToolContext) {
  return (await ctx.db.prepare(`SELECT o.id,o.email,o.access_generation AS generation,
    COALESCE(p.booking_mail_muted,0) AS bookingMailMuted FROM operators o
    JOIN oa_operators a ON a.id=o.id AND a.status='active' AND lower(trim(a.email))=o.normalized_email
    LEFT JOIN operator_delivery_preferences p ON p.operator_id=o.id
    WHERE o.removed_at IS NULL AND o.erased_at IS NULL ORDER BY o.id`)
    .all<{ id: string; email: string; generation: number; bookingMailMuted: number }>()).results;
}

export async function bookingRecipients(ctx: ToolContext, booking: BookingRecord, inviteeOnly = false) {
  const [hosts, guests] = await Promise.all([
    inviteeOnly ? Promise.resolve([]) : hostRecipients(ctx),
    ctx.db.prepare("SELECT email FROM booking_guests WHERE booking_id=? ORDER BY email").bind(booking.id).all<{ email: string }>(),
  ]);
  return [booking.inviteeEmail, ...guests.results.map(guest => guest.email), ...hosts.filter(host => !host.bookingMailMuted).map(host => host.email)];
}

export function bookingResult(booking: BookingRecord) {
  const money = booking.money;
  return { ...safeBooking(booking), calendarConflicts: booking.calendarConflicts.map(conflict => ({
    id: conflict.id, occurrenceId: conflict.occurrenceId, providerEventId: conflict.providerEventId,
    canonicalStartAt: conflict.canonicalStartAt, canonicalEndAt: conflict.canonicalEndAt,
    externalStartAt: conflict.externalStartAt, externalEndAt: conflict.externalEndAt,
    state: conflict.state, createdAt: conflict.createdAt,
  })), ...(money ? { money: {
    ledger: { priceCents: money.ledger.priceCents, paidCents: money.ledger.paidCents,
      refundedCents: money.ledger.refundedCents, feesCents: money.ledger.feesCents,
      netCents: money.ledger.netCents, taxCents: money.ledger.taxCents,
      balanceDueCents: money.ledger.balanceDueCents, refundableCents: money.ledger.refundableCents },
    cardSaved: Boolean(money.consent?.paymentMethodId),
    movements: money.movements.map(movement => ({ id: movement.id, kind: movement.kind,
      amountCents: movement.amountCents, taxCents: movement.taxCents, status: movement.status,
      actorType: movement.actorType, actorId: movement.actorId, reason: resourceText(movement.reason),
      processorRef: movement.processorRef, failureCode: movement.failureCode,
      createdAt: movement.createdAt, updatedAt: movement.updatedAt })),
  } } : {}) };
}

export async function bookingState(services: AppServices, id: string, ctx: ToolContext) {
  const booking = required(await services.bookings.getForOperator(id));
  const [recipients, event, capabilities] = await Promise.all([
    bookingRecipients(ctx, booking), booking.eventTypeId ? services.eventTypes.getEventType(booking.eventTypeId) : undefined,
    ctx.db.prepare(`SELECT id,expires_at AS expiresAt,rotated_at AS rotatedAt,invalidated_at AS invalidatedAt,updated_at AS updatedAt
      FROM booking_manage_tokens WHERE booking_id=? ORDER BY id`).bind(id).all(),
  ]);
  return { booking, recipients, event, capabilities: capabilities.results };
}

export const bookingRevision = (services: AppServices) => async ({ id }: { id: string }, ctx: ToolContext) => stateDigest(await bookingState(services, id, ctx));

export async function lifecycleClasses(services: AppServices, id: string, ctx: ToolContext, inviteeOnly = false): Promise<ClassAndFacts[]> {
  const booking = required(await services.bookings.getForOperator(id));
  const recipients = await bookingRecipients(ctx, booking, inviteeOnly);
  return [...standard(), external(recipients.length), ...(booking.calendarState !== "not_required" ? [live("calendar")] : [])];
}

export async function cancellationClasses(services: AppServices, id: string, ctx: ToolContext, amountCents?: number): Promise<ClassAndFacts[]> {
  const booking = required(await services.bookings.getForOperator(id));
  const effects = await lifecycleClasses(services, id, ctx, Boolean(booking.imported));
  // A native cancellation replay also resumes outstanding refund/void work.
  const pending = booking.money?.movements.filter(movement => movement.kind === "refund" && movement.status === "pending")
    .reduce((sum, movement) => sum + movement.amountCents, 0) ?? 0;
  const refundable = (booking.state === "cancelled" ? 0 : amountCents ?? booking.money?.ledger.refundableCents ?? 0) + pending;
  if (booking.money) effects.push(live("stripe"));
  if (refundable > 0) effects.push(moneyClass(refundable));
  return effects;
}
