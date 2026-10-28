import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { eventPriceInputSchema } from "../core/features/payments/pricing";
import { paymentTermsInputSchema } from "../core/features/payments/terms";
import { nativeTool, required, standard, live, external, objectOutput } from "./native-tool";
import { financial, usdAmount } from "./payment-facts";
import { paymentMoneyTools } from "./payment-money-tools";
import { accountingTools } from "./accounting-tools";
import { entitlementTools } from "./entitlement-tools";
import { noticeTools } from "./notice-tools";

const eventInput = z.object({ id: z.string().min(1).max(64) }).strict();
const noInput = z.object({}).strict();

/** Native PAY commands, plus their accounting, appointment-credit and notice boundaries. */
export function paymentTools(services: AppServices): ToolDefinition[] {
  const event = async (id: string) => required(await services.eventTypes.getEventType(id));
  const eventSummary = async (id: string) => {
    const saved = await event(id);
    return { target: { id: saved.id, name: saved.title } };
  };
  return [
    nativeTool({
      name: "dial.payments.stripe_status", title: "Read Stripe connection", description: "Read Stripe health, enabled payment methods and public setup endpoints without credentials.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput,
      classes: ["standard", "sensitive"], clauses: ["PAY-001"],
      classify: async () => (await services.payments.connection.status()).accountId ? [financial(1)] : standard(),
      run: async () => ({ result: await services.payments.connection.status() }),
    }),
    nativeTool({
      name: "dial.payments.stripe_disconnect", title: "Disconnect Stripe", description: "Stop new paid bookings and ask Stripe to revoke the current connection. Does not cancel existing bookings.",
      scope: "dial:write", readOnly: false, input: z.object({ id: z.enum(["stripe"]) }).strict(), outputSchema: objectOutput,
      classes: ["security", "live", "external"], clauses: ["PAY-001"],
      widens: false, narrowing: { effect: "revoke", target: "id" }, authority: async () => null,
      classify: async () => {
        const saved = await services.payments.connection.status();
        return [{ class: "security", facts: { measure: 1, setting: "stripe_connection" } }, live("booking-payments"), ...(saved.configured && saved.accountId ? [external(1)] : [])];
      },
      revisionType: "string", revision: async () => (await services.payments.connection.status()).statusChangedAt,
      summary: async () => ({ target: { id: "stripe", name: "Stripe connection" }, items: ["Stop new paid bookings", "Revoke Dial's Stripe access"] }),
      run: async () => ({ result: await services.payments.connection.disconnect() }),
    }),
    nativeTool({
      name: "dial.payments.ach_set", title: "Set ACH payment method", description: "Enable or disable ACH for the currently connected Stripe account.",
      scope: "dial:write", readOnly: false, input: z.object({ enabled: z.boolean() }).strict(), outputSchema: objectOutput,
      classes: ["live"], clauses: ["PAY-001"], classify: () => [live("booking-payments")],
      summary: args => ({ target: { id: "stripe", name: "Stripe payment methods" }, items: [args.enabled ? "Enable ACH" : "Disable ACH"] }),
      run: async args => {
        if (!await services.payments.setAch(args.enabled)) throw new ToolRefusal("stripe_not_connected");
        return { result: await services.payments.connection.status() };
      },
    }),
    nativeTool({
      name: "dial.payments.price_get", title: "Read event price", description: "Read an event's USD price and its duration-specific prices in cents.",
      scope: "dial:read", readOnly: true, input: eventInput, outputSchema: objectOutput, classes: ["standard"], clauses: ["PAY-001"],
      classify: async args => { await event(args.id); return standard(); },
      run: async args => { await event(args.id); return { result: await services.payments.eventPrice(args.id) }; },
    }),
    nativeTool({
      name: "dial.payments.price_set", title: "Set event price", description: "Set USD cents for the native event durations, preserving deposit compatibility. Does not charge anyone.",
      scope: "dial:write", readOnly: false, input: eventInput.extend({ price: eventPriceInputSchema }).strict(), outputSchema: objectOutput,
      classes: ["standard"], clauses: ["PAY-001", "PAY-003"], classify: async args => { await event(args.id); return standard(); },
      revisionType: "string", revision: async args => JSON.stringify([(await event(args.id)).updatedAt, await services.payments.eventPrice(args.id), (await services.payments.eventTerms(args.id)).version]),
      summary: async args => ({ ...await eventSummary(args.id), ...(args.price.amountCents !== null ? { amount: usdAmount(args.price.amountCents) } : {}), items: args.price.durationPrices.map(price => `${price.durationMinutes} minutes: ${price.amountCents / 100} USD`) }),
      run: async args => {
        const result = await services.payments.savePrice(await event(args.id), args.price);
        if (result.kind !== "saved") throw new ToolRefusal(result.kind === "deposit_conflict" ? "deposit_conflict" : "invalid_price");
        return { result: result.price };
      },
    }),
    nativeTool({
      name: "dial.payments.terms_get", title: "Read event payment terms", description: "Read the saved deposit, balance due time, cancellation window and consented fee settings.",
      scope: "dial:read", readOnly: true, input: eventInput, outputSchema: objectOutput, classes: ["standard"], clauses: ["PAY-003"],
      classify: async args => { await event(args.id); return standard(); },
      run: async args => { await event(args.id); return { result: await services.payments.eventTerms(args.id) }; },
    }),
    nativeTool({
      name: "dial.payments.terms_set", title: "Set event payment terms", description: "Save native deposit, balance and cancellation terms. Existing bookings retain the terms they accepted.",
      scope: "dial:write", readOnly: false, input: eventInput.extend({ terms: paymentTermsInputSchema }).strict(), outputSchema: objectOutput,
      classes: ["standard"], clauses: ["PAY-003"], classify: async args => { await event(args.id); return standard(); },
      revisionType: "integer", revision: async args => { await event(args.id); return (await services.payments.eventTerms(args.id)).version; },
      summary: async args => ({ ...await eventSummary(args.id), items: [
        args.terms.deposit.kind === "fixed" ? `Deposit: ${args.terms.deposit.amountCents / 100} USD` : args.terms.deposit.kind === "percent" ? `Deposit: ${args.terms.deposit.percent}%` : "No deposit",
        `Balance due ${args.terms.balanceDueHours} hours before the booking`,
        `Free cancellation window: ${args.terms.freeWindowHours === null ? "none" : `${args.terms.freeWindowHours} hours`}`,
        `Late cancellation fee: ${args.terms.lateCancelFeeCents / 100} USD`, `No-show fee: ${args.terms.noShowFeeCents / 100} USD`,
      ] }),
      run: async args => {
        const result = await services.payments.saveTerms(await event(args.id), args.terms);
        if (result.kind !== "saved") throw new ToolRefusal(result.refusal);
        return { result: result.terms };
      },
    }),
    nativeTool({
      name: "dial.payments.settings_get", title: "Read payment settings", description: "Read Stripe Tax and the business name used on invoices and receipts.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput, classes: ["standard"], clauses: ["PAY-005"],
      classify: () => standard(), run: async () => ({ result: await services.payments.settings() }),
    }),
    nativeTool({
      name: "dial.payments.settings_set", title: "Set tax and business settings", description: "Set Stripe Tax and the business name used on future native invoices and receipts.",
      scope: "dial:write", readOnly: false, input: z.object({ taxEnabled: z.boolean(), businessName: z.string().trim().max(120).nullable() }).strict(), outputSchema: objectOutput,
      classes: ["live"], clauses: ["PAY-005"], classify: () => [live("booking-payments")],
      summary: args => ({ target: { id: "payment-settings", name: "Payment settings" }, items: [args.taxEnabled ? "Enable Stripe Tax" : "Disable Stripe Tax", args.businessName ? `Business: ${args.businessName}` : "Use the host's name"] }),
      run: async args => { await services.payments.saveSettings({ taxEnabled: args.taxEnabled, businessName: args.businessName || null }); return { result: await services.payments.settings() }; },
    }),
    ...paymentMoneyTools(services), ...accountingTools(services), ...entitlementTools(services), ...noticeTools(services),
  ];
}
