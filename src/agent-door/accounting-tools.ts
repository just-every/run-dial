import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { nativeTool,objectOutput,standard } from "./native-tool";
import { financial,paymentBooking } from "./payment-facts";

const noInput = z.object({}).strict();

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
  ];
}
