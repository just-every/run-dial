import { formatUsd } from "../../shared/event-price";
import { createId, nowIso } from "../../shared/ids";
import { eventPrice, priceForDuration } from "./pricing";
import type { MoneyRepository } from "./money-repository";
import type { MoneyService } from "./money-service";
import type { Movement, MovementsRepository } from "./movements-repository";
import type { PaymentsRepository } from "./repository";
import { StripeApiError } from "./stripe-api";
import { calculateTax, type BillingAddress } from "./tax";

const dueInDays = 7;
type InvoiceBooking = { id: string; state: string; eventTypeId: string | null; eventTitle: string; durationMinutes: number; inviteeName: string; inviteeEmail: string };
export type InvoiceView = { id: string; number: string | null; url: string; amountCents: number; taxCents: number; taxSummary: string | null; status: Movement["status"] };

/** PAY-005 (D6): a host invoices a confirmed booking that was not paid upfront, for its duration's price plus sales
 * tax when Stripe Tax is on. Stripe hosts the invoice and its payment page; only Stripe's signed `invoice.paid`
 * marks it paid, and issuing again returns the same invoice. */
export class InvoiceService {
  constructor(private readonly db: D1Database, private readonly payments: PaymentsRepository, private readonly money: MoneyRepository, private readonly movements: MovementsRepository, private readonly service: MoneyService) {}

  /** Whether the booking record offers an invoice, for how much before tax, and whether it needs a billing address. */
  async offer(bookingId: string) {
    const booking = await this.db.prepare(`SELECT b.state, b.event_type_id AS eventTypeId, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ?`).bind(bookingId).first<{ state: string; eventTypeId: string | null; durationMinutes: number }>();
    if (!booking || booking.state === "cancelled" || await this.payments.bookingPayment(bookingId) || (await this.movements.forBooking(bookingId)).some(movement => movement.kind === "invoice")) return undefined;
    const priceCents = booking.eventTypeId ? priceForDuration(eventPrice(await this.payments.prices(booking.eventTypeId)), booking.durationMinutes) : undefined;
    return priceCents === undefined ? undefined : { priceCents, taxRequired: (await this.money.settings()).taxEnabled };
  }

  async issue(bookingId: string, operatorId: string, address?: BillingAddress) {
    const booking = await this.db.prepare(`SELECT b.id, b.state, b.event_type_id AS eventTypeId, b.event_title AS eventTitle, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail
      FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ?`).bind(bookingId).first<InvoiceBooking>();
    if (!booking) return { kind: "not_found" as const };
    const existing = (await this.movements.forBooking(bookingId)).find(movement => movement.kind === "invoice");
    if (existing?.invoiceId && existing.invoiceUrl) return { kind: "issued" as const, invoice: view(existing) };
    if (existing?.status === "failed") return { kind: "failed" as const, reason: existing.failureCode ?? "invoice_failed" };
    if (booking.state === "cancelled") return { kind: "not_eligible" as const, reason: "booking_cancelled" };
    if (await this.payments.bookingPayment(bookingId)) return { kind: "not_eligible" as const, reason: "paid_upfront" };
    const priceCents = booking.eventTypeId ? priceForDuration(eventPrice(await this.payments.prices(booking.eventTypeId)), booking.durationMinutes) : undefined;
    if (priceCents === undefined) return { kind: "not_eligible" as const, reason: "not_priced" };
    const settings = await this.money.settings();
    if (settings.taxEnabled && !address) return { kind: "address_required" as const };
    const live = await this.service.live();
    if ("refusal" in live) return { kind: "refused" as const, reason: live.refusal };
    const tax = settings.taxEnabled && address ? await calculateTax(live.api, live.accountId, { amountCents: priceCents, reference: `booking:${bookingId}`, address }) : undefined;
    const taxCents = tax?.taxCents ?? 0, key = `invoice:${bookingId}`;
    await this.movements.insert([{ bookingId, kind: "invoice", amountCents: priceCents + taxCents, taxCents, taxSummary: tax?.summary ?? null, actorType: "operator", actorId: operatorId, reason: "Invoice instead of upfront payment", accountId: live.accountId, sourceRef: null, idempotencyKey: key }]);
    const movement = (await this.movements.byKey(key))!;
    const businessName = settings.businessName ?? settings.hostName ?? "Dial";
    try {
      const customer = await live.api.createCustomer(live.accountId, { email: booking.inviteeEmail, name: booking.inviteeName.slice(0, 200), "metadata[dial_booking_id]": bookingId,
        ...(address ? { "address[line1]": address.line1, ...(address.line2 ? { "address[line2]": address.line2 } : {}), "address[city]": address.city, "address[state]": address.state, "address[postal_code]": address.postalCode, "address[country]": address.country } : {}) }, `dial-invoice-${movement.id}-customer`);
      const draft = await live.api.createInvoice(live.accountId, { customer: customer.id, collection_method: "send_invoice", days_until_due: String(dueInDays), auto_advance: "false", description: `${booking.eventTitle} with ${businessName}`.slice(0, 500),
        "metadata[dial_movement_id]": movement.id, "metadata[dial_booking_id]": bookingId }, `dial-invoice-${movement.id}-invoice`);
      await live.api.createInvoiceItem(live.accountId, { customer: customer.id, invoice: draft.id, amount: String(priceCents), currency: "usd", description: `${booking.eventTitle} (${booking.durationMinutes} minutes)`.slice(0, 500) }, `dial-invoice-${movement.id}-item-0`);
      if (taxCents > 0) await live.api.createInvoiceItem(live.accountId, { customer: customer.id, invoice: draft.id, amount: String(taxCents), currency: "usd", description: `Sales tax${tax?.summary ? ` (${tax.summary})` : ""}`.slice(0, 500) }, `dial-invoice-${movement.id}-item-1`);
      const invoice = await live.api.finalizeInvoice(live.accountId, draft.id, `dial-invoice-${movement.id}-finalize`);
      if (invoice.total !== movement.amountCents || !invoice.hosted_invoice_url) { await this.movements.fail(movement.id, "invoice_amount_mismatch"); return { kind: "failed" as const, reason: "invoice_amount_mismatch" }; }
      await this.movements.attachInvoice(movement.id, { id: invoice.id, number: invoice.number, url: invoice.hosted_invoice_url });
      await this.db.batch([invoiceMail(this.db, booking, { id: invoice.id, number: invoice.number, url: invoice.hosted_invoice_url, amountCents: movement.amountCents, taxCents, taxSummary: tax?.summary ?? null }, businessName)]);
      return { kind: "issued" as const, invoice: view((await this.movements.get(movement.id))!) };
    } catch (error) {
      // A definite refusal is recorded; a lost response stays pending, and issuing again resumes with the same keys.
      if (error instanceof StripeApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429) await this.movements.fail(movement.id, error.code);
      return { kind: "failed" as const, reason: error instanceof StripeApiError ? error.code : "stripe_unavailable" };
    }
  }

  /** Stripe's signed `invoice.paid` settles the invoice once and queues its receipt; nothing else marks it paid. */
  async receiveInvoiceEvent(event: { type: string; account?: string; data: { object: Record<string, unknown> } }, movement: Movement) {
    if (event.account !== movement.accountId) return { kind: "unauthorized" as const };
    if (event.type !== "invoice.paid") return { kind: "ignored" as const };
    const object = event.data.object;
    if (movement.status === "succeeded") return { kind: "processed" as const };
    if (object.id !== movement.invoiceId || object.status !== "paid" || object.amount_paid !== movement.amountCents || object.currency !== "usd") return { kind: "rejected" as const };
    const ref = typeof object.payment_intent === "string" ? object.payment_intent : object.id as string;
    await this.movements.succeed(movement.id, ref, await this.service.receipt(movement, ref));
    return { kind: "processed" as const };
  }
}

function view(movement: Movement): InvoiceView {
  return { id: movement.invoiceId!, number: movement.invoiceNumber, url: movement.invoiceUrl!, amountCents: movement.amountCents, taxCents: movement.taxCents, taxSummary: movement.taxSummary, status: movement.status };
}

/** The invoice reaches the invitee with Stripe's hosted payment link. */
function invoiceMail(db: D1Database, booking: InvoiceBooking, invoice: Omit<InvoiceView, "status">, businessName: string) {
  const tax = invoice.taxCents > 0 ? ` including ${formatUsd(invoice.taxCents)} sales tax${invoice.taxSummary ? ` (${invoice.taxSummary})` : ""}` : "";
  const email = { messageKind: "invoice", to: booking.inviteeEmail, recipientRole: "invitee", subject: `Invoice from ${businessName}: ${formatUsd(invoice.amountCents)}`,
    text: [`Invoice ${invoice.number ?? invoice.id} from ${businessName}`, `${booking.eventTitle}: ${formatUsd(invoice.amountCents)}${tax}, due in ${dueInDays} days.`, `Pay securely on Stripe: ${invoice.url}`].join("\n") };
  const now = nowIso();
  return db.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
    SELECT ?, 'mail_send', ?, ?, NULL, NULL, ?, 'pending', 0, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?) ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(createId(), `booking:${booking.id}:invoice:${invoice.id}:invitee`, booking.id, JSON.stringify(email), now, now, now, booking.id);
}
