import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { nativeTool, standard, objectOutput } from "./native-tool";


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
  ];
}
