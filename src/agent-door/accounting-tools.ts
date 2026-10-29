import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { nativeTool,objectOutput,standard } from "./native-tool";
import { financial } from "./payment-facts";

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
