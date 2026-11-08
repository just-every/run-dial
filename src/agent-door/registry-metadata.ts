import type { AgentDoorOptions, Runtime } from "../../modules/agent-door/types.ts";
import { describeTool, registry } from "../../modules/agent-door/registry.ts";
import { eventsTool } from "../../modules/agent-door/events.ts";

/** Describe registration definitions without resolving, classifying or running a tool. */
export function registryMetadata(options: AgentDoorOptions) {
  const runtime: Runtime = { options, tools: registry(options), now: options.now ?? Date.now };
  const tools = [...runtime.tools, eventsTool(runtime)]
    .sort((a, b) => a.name.localeCompare(b.name)).map(describeTool);
  return {
    name: options.name,
    specialist: options.specialist,
    tools: tools.map(tool => ({ name: tool.name, title: tool.title, description: tool.description,
      classes: tool._meta["com.runeditrun/classes"], scope: tool._meta["com.runeditrun/scope"] })),
    resourceTemplates: [...options.resources ?? []]
      .sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate))
      .map(resource => ({ name: resource.name, uriTemplate: resource.uriTemplate, description: resource.description ?? "" })),
  };
}

export type RegistryMetadata = ReturnType<typeof registryMetadata>;
