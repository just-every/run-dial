import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { brandTools } from "./brand-tools";
import { clientTools } from "./client-tools";
import { customTools } from "./custom-tools";
import { linkTools } from "./link-tools";
import { pollTools } from "./poll-tools";

export function workspaceTools(services: AppServices): ToolDefinition[] {
  return [...clientTools(services), ...pollTools(services), ...linkTools(services), ...customTools(services), ...brandTools(services)];
}
