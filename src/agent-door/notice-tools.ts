import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { nativeTool, standard, live, objectOutput } from "./native-tool";
import { paymentCommand } from "./payment-facts";

/** Connection establishment stays in native setup: Slack needs session-bound
 * OAuth, and Teams' Workflows URL is a bearer secret unsuitable for tool args. */
export function noticeTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.notices.status", title: "Read workspace notice health", description: "Read Slack and Teams destination health, generation and masked destination labels without tokens or Workflows URLs.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: objectOutput,
      classes: ["standard"], clauses: ["FLOW-005"], classify: () => standard(),
      run: async () => ({ result: await services.notices.destinations.status() }),
    }),
    nativeTool({
      name: "dial.notices.disconnect", title: "Disconnect workspace notices", description: "Disconnect exactly Slack or Teams, remove the stored credential and fail pending notices for that destination. Does not delete previously delivered messages.",
      scope: "dial:write", readOnly: false, input: z.object({ id: z.enum(["slack", "teams"]) }).strict(), outputSchema: objectOutput,
      classes: ["security", "live"], clauses: ["FLOW-005"],
      widens: false, narrowing: { effect: "revoke", target: "id" }, authority: async () => null,
      classify: args => [{ class: "security", facts: { measure: 1, setting: `${args.id}_notice_connection` } }, live("workspace-notices")],
      revisionType: "integer", revision: async args => (await services.notices.destinations.get(args.id))?.generation ?? null,
      summary: args => ({ target: { id: args.id, name: args.id === "slack" ? "Slack notices" : "Teams notices" }, items: ["Remove the local notice credential", "Fail pending notices for this destination"] }),
      run: async args => ({ result: await paymentCommand(() => services.notices.destinations.disconnect(args.id)) }),
    }),
  ];
}
