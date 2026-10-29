import { eventChangeClasses } from "./event-tool-support";
import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { productInput } from "../core/features/payments/entitlements";
import { arrayOutput,nativeTool,objectOutput,required,standard } from "./native-tool";
import { financial,usdAmount } from "./payment-facts";

const eventInput = z.object({ id: z.string().min(1).max(64) }).strict();

/** Purchases, bearer credit codes and checkout capabilities stay in their public native door. */
export function entitlementTools(services: AppServices): ToolDefinition[] {
  const event = async (id: string) => required(await services.eventTypes.getEventType(id));
  return [
    nativeTool({
      name: "dial.entitlements.list", title: "List appointment credits", description: "Read purchased packages, memberships and gift balances, expiry, purchaser email and redemption history. Does not expose redeemable codes.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: arrayOutput,
      classes: ["sensitive"], clauses: ["PAY-004"],
      classify: async () => [financial((await services.payments.entitlements.list()).length)],
      run: async () => ({ result: await services.payments.entitlements.list() }),
    }),
    nativeTool({
      name: "dial.entitlements.products", title: "List event appointment products", description: "Read the event's native package, membership and gift definitions. Prices are USD cents.",
      scope: "dial:read", readOnly: true, input: eventInput, outputSchema: arrayOutput, classes: ["standard"], clauses: ["PAY-004"],
      classify: async args => { await event(args.id); return standard((await services.payments.entitlements.products(args.id)).length); },
      run: async args => { await event(args.id); return { result: await services.payments.entitlements.products(args.id) }; },
    }),
    nativeTool({
      name: "dial.entitlements.product_define", title: "Define appointment product", description: "Define a native event package, membership or gift in USD cents. This definition creates no purchase, recurring charge or credit.",
      scope: "dial:write", readOnly: false, input: eventInput.extend({ product: productInput }).strict(), outputSchema: objectOutput,
      classes: ["standard", "live", "external"], clauses: ["PAY-004"], classify: async args => eventChangeClasses([await event(args.id)]),
      revisionType: "string", revision: async args => JSON.stringify([(await event(args.id)).updatedAt, await services.payments.entitlements.products(args.id)]),
      summary: async args => {
        const saved = await event(args.id);
        return { target: { id: saved.id, name: saved.title }, amount: usdAmount(args.product.amountCents), payee: (await services.payments.settings()).effectiveBusinessName,
          items: [args.product.name, args.product.kind, args.product.kind === "gift" ? `Gift balance: ${args.product.amountCents / 100} USD` : `${args.product.sessions} sessions`, `Valid for ${args.product.validityDays} days`, ...(args.product.kind === "membership" ? ["Purchased membership renews monthly through Stripe"] : [])] };
      },
      run: async args => { const saved = await event(args.id); return { result: await services.payments.entitlements.define(saved.id, args.product) }; },
    }),
  ];
}
