import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { nativeTool, standard, external, live, objectOutput } from "./native-tool";
import { financial, paymentBooking, paymentCommand, usdAmount } from "./payment-facts";

const noInput = z.object({}).strict();
type ExportPayment = { bookingId: string; reference: string; amountCents: number; taxCents: number };

/** Exact eligible native accounting inputs, never customer or connection credentials. */
async function exportPayments(db: D1Database) {
  return (await db.prepare(`SELECT booking_id AS bookingId,payment_intent_id AS reference,amount_cents AS amountCents,tax_cents AS taxCents
    FROM booking_payments WHERE payment_intent_id IS NOT NULL UNION ALL
    SELECT booking_id,processor_ref,amount_cents,tax_cents FROM payment_movements
    WHERE status='succeeded' AND kind IN ('balance','invoice','late_cancel_fee','no_show_fee') AND processor_ref IS NOT NULL`)
    .all<ExportPayment>()).results;
}

async function connectionRevision(db: D1Database) {
  return db.prepare("SELECT realm_id AS realmId,status,income_account_id AS incomeAccountId,item_id AS itemId,updated_at AS updatedAt FROM accounting_connections WHERE id='quickbooks'")
    .first<{ realmId: string; status: string; incomeAccountId: string | null; itemId: string | null; updatedAt: string }>();
}

export function accountingTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.accounting.reconciliation", title: "Read payment reconciliation", description: "Read native local and signed processor payment facts, disagreements, disputes and accounting-export state. Does not move money.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput,
      classes: ["sensitive"], clauses: ["PAY-006"],
      classify: async () => [financial((await services.payments.reconciliation.rows()).length)],
      run: async () => ({ result: { rows: await services.payments.reconciliation.rows() } }),
    }),
    nativeTool({
      name: "dial.accounting.reconciliation_acknowledge", title: "Acknowledge processor refund", description: "Acknowledge the exact signed out-of-band refund disagreement on a booking; creates no refund.",
      scope: "dial:write", readOnly: false, input: z.object({ id: z.string().length(26), processorRef: z.string().min(1).max(200) }).strict(), outputSchema: objectOutput,
      classes: ["standard", "sensitive"], clauses: ["PAY-006"],
      classify: async args => { await paymentBooking(services, args.id); return [...standard(), financial(1)]; },
      revisionType: "string", revision: async (args, ctx) => JSON.stringify(await ctx.db.prepare("SELECT id,disagreement,updated_at AS updatedAt,resolved_at AS resolvedAt FROM payment_processor_facts WHERE booking_id=? AND processor_ref=? AND kind='refund' ORDER BY id").bind(args.id, args.processorRef).all().then(rows => rows.results)),
      summary: async args => {
        const booking = await paymentBooking(services, args.id);
        return { target: { id: booking.id, name: booking.eventTitle }, items: [`Acknowledge refund ${args.processorRef}`] };
      },
      run: async (args, ctx) => {
        await paymentBooking(services, args.id);
        return { result: { resolved: await services.payments.reconciliation.resolve(args.id, args.processorRef, ctx.person.id) } };
      },
    }),
    nativeTool({
      name: "dial.accounting.csv", title: "Export payment CSV", description: "Read the native formula-safe reconciliation CSV. Amounts are labeled minor units with their currency.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["PAY-006"],
      classify: async () => [financial((await services.payments.reconciliation.rows()).length)],
      run: async () => ({ result: { filename: "dial-payments.csv", contentType: "text/csv; charset=utf-8", csv: await services.payments.reconciliation.csv() } }),
    }),
    nativeTool({
      name: "dial.accounting.status", title: "Read QuickBooks connection", description: "Read native QuickBooks health and income-account mapping without OAuth credentials.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput, classes: ["standard"], clauses: ["PAY-006"],
      classify: () => standard(), run: async () => ({ result: await services.payments.accounting.status() }),
    }),
    nativeTool({
      name: "dial.accounting.accounts", title: "List QuickBooks income accounts", description: "Read income accounts from the connected QuickBooks company through the native provider service.",
      scope: "dial:read", readOnly: true, input: noInput, outputSchema: objectOutput, classes: ["external", "sensitive"], clauses: ["PAY-006"],
      classify: () => [external(1), financial(1)],
      run: async () => ({ result: { accounts: await paymentCommand(() => services.payments.accounting.accounts()) } }),
    }),
    nativeTool({
      name: "dial.accounting.mapping_set", title: "Map QuickBooks income account", description: "Validate a native income account, find or create its Dial service item in QuickBooks, and save the mapping.",
      scope: "dial:write", readOnly: false, input: z.object({ accountId: z.string().regex(/^[A-Za-z0-9-]{1,50}$/) }).strict(), outputSchema: objectOutput,
      classes: ["standard", "external", "live"], clauses: ["PAY-006"], classify: () => [...standard(), external(1), live("accounting-export")],
      revisionType: "string", revision: async (_args, ctx) => JSON.stringify(await connectionRevision(ctx.db)),
      summary: args => ({ target: { id: args.accountId, name: "QuickBooks income account" }, recipients: ["QuickBooks"], items: ["Validate account and save its Dial service-item mapping"] }),
      run: async args => ({ result: await paymentCommand(() => services.payments.accounting.map(args.accountId)) }),
    }),
    nativeTool({
      name: "dial.accounting.export", title: "Export payments to QuickBooks", description: "Export anonymous native payment facts as QuickBooks sales receipts with durable per-payment request IDs. Never moves money; native USD-company and tax-mapping refusals apply.",
      scope: "dial:write", readOnly: false, input: noInput, outputSchema: objectOutput,
      classes: ["external", "sensitive"], clauses: ["PAY-006"],
      classify: async (_args, ctx) => [external(1), financial((await exportPayments(ctx.db)).length)],
      revisionType: "string", revision: async (_args, ctx) => JSON.stringify([await connectionRevision(ctx.db), await exportPayments(ctx.db)]),
      summary: async (_args, ctx) => {
        const payments = await exportPayments(ctx.db);
        return { target: { id: "quickbooks", name: "Connected QuickBooks company" }, recipients: ["QuickBooks"], amount: usdAmount(payments.reduce((sum, payment) => sum + payment.amountCents, 0)), items: [`${payments.length} eligible payment facts; already-exported references are retained once`, "Anonymous payment references and amounts only"] };
      },
      run: async () => ({ result: { exports: await paymentCommand(() => services.payments.accounting.export()) } }),
    }),
    nativeTool({
      name: "dial.accounting.disconnect", title: "Disconnect QuickBooks", description: "Remove Dial's locally stored QuickBooks tokens and stop future accounting exports. Does not delete provider receipts.",
      scope: "dial:write", readOnly: false, input: z.object({ id: z.enum(["quickbooks"]) }).strict(), outputSchema: objectOutput,
      classes: ["security", "live"], clauses: ["PAY-006"],
      widens: false, narrowing: { effect: "revoke", target: "id" }, authority: async () => null,
      classify: () => [{ class: "security", facts: { measure: 1, setting: "quickbooks_connection" } }, live("accounting-export")],
      revisionType: "string", revision: async (_args, ctx) => (await connectionRevision(ctx.db))?.updatedAt ?? null,
      summary: () => ({ target: { id: "quickbooks", name: "QuickBooks connection" }, items: ["Remove local connection credentials and stop exports"] }),
      run: async () => ({ result: await paymentCommand(() => services.payments.accounting.disconnect()) }),
    }),
  ];
}
