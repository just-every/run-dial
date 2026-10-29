import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { billingAddressSchema } from "../core/features/payments/tax";
import { nativeTool, required, external, objectOutput } from "./native-tool";
import { feeRecipients, financial, moneyAmount, moneyRevision, moneyView, paymentBooking, usdAmount } from "./payment-facts";

const bookingInput = z.object({ id: z.string().length(26) }).strict();
const refundInput = bookingInput.extend({
  amountCents: z.number().int().min(1).max(99_999_999), reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().uuid(),
}).strict();

export function paymentMoneyTools(services: AppServices): ToolDefinition[] {
  const refund = async (args: z.infer<typeof refundInput>) => {
    const booking = await paymentBooking(services, args.id);
    const movements = await services.payments.money.movements.forBooking(args.id);
    const own = movements.filter(movement => movement.idempotencyKey.startsWith(`${args.idempotencyKey}:`));
    if (own.length && (own.reduce((sum, movement) => sum + movement.amountCents, 0) !== args.amountCents || own.some(movement => movement.reason !== args.reason))) throw new ToolRefusal("idempotency_key_reused");
    // The native settle command runs every pending refund/fee for the booking.
    if (movements.some(movement => movement.status === "pending" && !["balance", "invoice"].includes(movement.kind) && !own.some(saved => saved.id === movement.id))) throw new ToolRefusal("pending_money_movements");
    return booking;
  };
  const noShow = async (id: string) => {
    const booking = await paymentBooking(services, id);
    if (booking.attendance?.status !== "no_show") throw new ToolRefusal("not_marked_no_show");
    const money = booking.money;
    if (!money?.snapshot?.noShowFeeCents || !money.consent?.paymentMethodId || money.consent.noShowFeeCents !== money.snapshot.noShowFeeCents) throw new ToolRefusal("no_consented_fee");
    if (money.movements.some(movement => movement.status === "pending" && !["balance", "invoice", "no_show_fee"].includes(movement.kind))) throw new ToolRefusal("pending_money_movements");
    return { booking, amountCents: money.consent.noShowFeeCents };
  };
  const invoice = async (id: string) => {
    const booking = await paymentBooking(services, id);
    const existing = booking.money?.movements.find(movement => movement.kind === "invoice");
    if (existing?.invoiceId && existing.invoiceUrl) return { booking, amountCents: existing.amountCents, existing: true };
    // Native recovery recalculates current pricing/tax before resuming. Keep an
    // unfinished invoice in the native recovery flow until it has a quote door.
    if (existing) throw new ToolRefusal("invoice_recovery_required");
    const offer = await services.payments.invoices.offer(id);
    if (!offer) throw new ToolRefusal("invoice_not_available");
    // Native Tax calculates while issuing, with no read-only quote command. Never
    // classify an unknown tax amount as the smaller pre-tax commitment.
    if (offer.taxRequired) throw new ToolRefusal("invoice_tax_quote_required");
    return { booking, amountCents: offer.priceCents, existing: false };
  };
  return [
    nativeTool({
      name: "dial.payments.booking_money", title: "Read booking money", description: "Read the booking's payments, ledger, terms, consent and movements without private payment links or saved-card identifiers.",
      scope: "dial:read", readOnly: true, input: bookingInput, outputSchema: objectOutput,
      classes: ["sensitive"], clauses: ["PAY-001", "PAY-003", "PAY-005", "PAY-006"],
      classify: async args => { await paymentBooking(services, args.id); return [financial(1)]; },
      run: async args => {
        const booking = await paymentBooking(services, args.id);
        return { result: { money: moneyView(booking.money), invoiceOffer: await services.payments.invoices.offer(args.id) ?? null } };
      },
    }),
    nativeTool({
      name: "dial.payments.refund", title: "Refund booking payment", description: "Refund a USD amount in cents with the native reason and idempotency key. Refuses unrelated pending money movements.",
      scope: "dial:write", readOnly: false, input: refundInput, outputSchema: objectOutput,
      classes: ["money", "external", "sensitive"], clauses: ["PAY-003", "AGENT-001"],
      classify: async args => { await refund(args); return [moneyAmount(args.amountCents), external(1), financial(1)]; },
      revisionType: "string", revision: args => moneyRevision(services, args.id),
      summary: async args => {
        const booking = await refund(args);
        return { target: { id: booking.id, name: booking.eventTitle, email: booking.inviteeEmail }, amount: usdAmount(args.amountCents), payee: booking.inviteeEmail, recipients: ["Stripe"], items: [args.reason] };
      },
      run: async (args, ctx) => {
        await refund(args);
        const result = await services.payments.money.refund(args.id, ctx.person.id, { amountCents: args.amountCents, reason: args.reason, idempotencyKey: args.idempotencyKey });
        if (result.kind === "not_found") throw new ToolRefusal("not_found");
        if (result.kind === "refused") throw new ToolRefusal(result.reason);
        if (result.kind === "exceeds_refundable") throw new ToolRefusal("refund_exceeds_paid", undefined, { refundableCents: result.refundableCents });
        if (result.kind === "key_reused") throw new ToolRefusal("idempotency_key_reused");
        return { result: { money: moneyView((await paymentBooking(services, args.id)).money) } };
      },
    }),
    nativeTool({
      name: "dial.payments.no_show_fee", title: "Charge consented no-show fee", description: "Charge only the exact saved no-show fee after a no-show mark and matching recorded saved-card consent; native once-only fee and receipts apply.",
      scope: "dial:write", readOnly: false, input: bookingInput, outputSchema: objectOutput,
      classes: ["money", "external", "sensitive"], clauses: ["PAY-003", "PAY-005", "NOTIFY-008", "AGENT-001"],
      classify: async (args, ctx) => {
        const saved = await noShow(args.id);
        return [moneyAmount(saved.amountCents), external(1 + (await feeRecipients(services, ctx.db, args.id)).length), financial(1)];
      },
      revisionType: "string", revision: args => moneyRevision(services, args.id),
      summary: async (args, ctx) => {
        const saved = await noShow(args.id);
        return { target: { id: saved.booking.id, name: saved.booking.eventTitle, email: saved.booking.inviteeEmail }, amount: usdAmount(saved.amountCents), payee: (await services.payments.settings()).effectiveBusinessName,
          recipients: ["Stripe", ...await feeRecipients(services, ctx.db, args.id)], items: ["Exact fee from this booking's recorded consent", "Receipt to the stored invitee and current native host recipients"] };
      },
      run: async (args, ctx) => {
        await noShow(args.id);
        const result = await services.payments.money.chargeNoShowFee(args.id, ctx.person.id);
        if (result.kind === "not_found") throw new ToolRefusal("not_found");
        if (result.kind === "refused") throw new ToolRefusal(result.reason);
        if (result.kind === "not_no_show") throw new ToolRefusal("not_marked_no_show");
        if (result.kind === "no_consented_fee") throw new ToolRefusal("no_consented_fee");
        return { result: { money: moneyView((await paymentBooking(services, args.id)).money) } };
      },
    }),
    nativeTool({
      name: "dial.payments.invoice_issue", title: "Issue booking invoice", description: "Issue the native invoice for the stored booking and email it to its invitee. Payment requires Stripe's signed confirmation. Tax-enabled issuance and unfinished invoice recovery require a native pre-issue quote and are refused until available.",
      scope: "dial:write", readOnly: false, input: bookingInput.extend({ billingAddress: billingAddressSchema.optional() }).strict(), outputSchema: objectOutput,
      classes: ["commitment", "external", "sensitive"], clauses: ["PAY-005", "AGENT-001"],
      classify: async args => {
        const saved = await invoice(args.id);
        return [{ class: "commitment", facts: { measure: saved.amountCents, currency: "USD", counterparty: "known" } }, external(saved.existing ? 0 : 2), financial(1)];
      },
      revisionType: "string", revision: async args => JSON.stringify([await moneyRevision(services, args.id), await services.payments.invoices.offer(args.id) ?? null]),
      summary: async args => {
        const saved = await invoice(args.id);
        return { target: { id: saved.booking.id, name: saved.booking.eventTitle, email: saved.booking.inviteeEmail }, amount: usdAmount(saved.amountCents), payee: (await services.payments.settings()).effectiveBusinessName,
          recipients: saved.existing ? [] : ["Stripe", saved.booking.inviteeEmail], items: [saved.existing ? "Read or resume the existing invoice" : "Issue invoice due in 7 days and email the stored invitee"] };
      },
      run: async (args, ctx) => {
        await invoice(args.id);
        const result = await services.payments.invoices.issue(args.id, ctx.person.id, args.billingAddress);
        if (result.kind === "not_found") throw new ToolRefusal("not_found");
        if (result.kind === "refused") throw new ToolRefusal(result.reason);
        if (result.kind === "address_required") throw new ToolRefusal("billing_address_required");
        if (result.kind === "failed") throw new ToolRefusal("invoice_failed", undefined, { reason: result.reason });
        if (result.kind === "not_eligible") throw new ToolRefusal("invoice_not_available", undefined, { reason: result.reason });
        const saved = required(result.invoice);
        return { result: { invoice: { id: saved.id, number: saved.number, amountCents: saved.amountCents, taxCents: saved.taxCents, taxSummary: saved.taxSummary, status: saved.status }, money: moneyView((await paymentBooking(services, args.id)).money) } };
      },
    }),
  ];
}
