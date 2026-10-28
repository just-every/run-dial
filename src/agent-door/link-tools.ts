import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { arrayOutput, live, nativeTool, objectOutput, required, standard } from "./native-tool";

const target = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).strict();
const uri = (id: string) => `dial://booking-links/${id}`;

export function linkTools(services: AppServices): ToolDefinition[] {
  const record = async (id: string) => required((await services.bookingLinks.list()).find(link => link.id === id));
  return [
    nativeTool({
      name: "dial.booking_links.list", title: "List private booking links", description: "List native single-use and one-off link definitions, offered times, expiry, holds and state. Share bearer URLs and tokens are excluded.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: arrayOutput, classes: ["standard"], clauses: ["LINK-001", "LINK-002"],
      classify: () => standard(0), run: async () => ({ result: await services.bookingLinks.list() }),
    }),
    nativeTool({
      name: "dial.booking_links.revoke", title: "Revoke private booking link", description: "Revoke a native private booking capability and immediately release any live offered-time hold.",
      scope: "dial:write", readOnly: false, input: target, outputSchema: objectOutput, classes: ["standard", "access", "live"], clauses: ["LINK-001", "LINK-002"],
      widens: false, narrowing: { effect: "revoke", target: "id" },
      classify: async (args, ctx) => {
        const link = await record(args.id);
        return [...standard(), { class: "access", facts: { measure: link.state === "active" ? 1 : 0, direction: "narrows" } },
          ...(link.state === "active" && link.holdUntil && Date.parse(link.holdUntil) > ctx.now() ? [live("booking availability")] : [])];
      },
      authority: async args => ({ subject: `booking-link:${args.id}`, widens: false }),
      summary: async args => {
        const link = await record(args.id), event = await services.eventTypes.getEventType(link.eventTypeId);
        return { target: { id: link.id, name: event?.title ?? link.kind }, items: ["Revoke private booking authority and release remaining offered-time holds", `Current state: ${link.state}`] };
      },
      async run(args, ctx) {
        if (!await services.bookingLinks.revoke(args.id)) throw new ToolRefusal("link_not_found");
        ctx.emit("dial.booking_link.revoked", uri(args.id), { actorLabel: ctx.actor.label });
        return { result: { revoked: true } };
      },
    }),
  ];
}
