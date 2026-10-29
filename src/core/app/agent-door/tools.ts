import type { ToolDefinition } from "../../../base/modules/agent-door/index.ts";
import type { AppServices } from "../services";
import type { AppBindings } from "../bindings";
import { nativeToolContext } from "./tool-context";
import { profileTools } from "./profile-tools";
import { eventTools } from "./event-tools";
import { scheduleTools } from "./schedule-tools";

export function nativeTools(
  env: AppBindings,
  services: AppServices,
): ToolDefinition[] {
  const context = nativeToolContext(env, services);
  profileTools(context);
  eventTools(context);
  scheduleTools(context);
  return context.tools;
}
