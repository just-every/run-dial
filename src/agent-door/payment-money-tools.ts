import { z } from "zod";

import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";

import { nativeTool, objectOutput } from "./native-tool";
import { financial, moneyView, paymentBooking } from "./payment-facts";

const bookingInput = z.object({ id: z.string().length(26) }).strict();

export function paymentMoneyTools(services: AppServices): ToolDefinition[] {
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
  ];
}
