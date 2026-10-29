import { ZodError } from "zod";
import {
  ToolRefusal,
  type ToolDefinition,
  type ToolContext,
  type ClassAndFacts,
} from "../../../base/modules/agent-door/index.ts";
import { createServices, type AppServices } from "../services";
import type { AppBindings } from "../bindings";
import { parseRuntimeEnvironment } from "../../shared/runtime-env";
import { authorize, effectDatabase } from "./native";
import { riskWitness } from "./risk-witness";
import { idInput, outputSchema } from "./schemas";
export const standard: ClassAndFacts[] = [
  { class: "standard", facts: { measure: 1 } },
];
export const live: ClassAndFacts[] = [
  { class: "live", facts: { measure: 1, service: "booking" } },
];
export const destructive: ClassAndFacts[] = [
  { class: "destructive", facts: { measure: 1 } },
];
export const resource = (kind: string, record: { id: string }) => [
  { uri: `dial://${kind}/${record.id}`, name: kind },
];
export function nativeToolContext(env: AppBindings, services: AppServices) {
  const classified = new Map<string, string>();
  const forEffect = (
    ctx: ToolContext,
    tool: string,
    target: { kind: string; id: string } | null,
    revision?: {
      table: "event_types" | "host_profiles" | "availability_schedules";
      id: string;
      value: string;
    },
  ) =>
    createServices(
      effectDatabase(
        env.DB,
        ctx,
        tool,
        target,
        revision,
        classified.get(ctx.operationId),
      ),
      parseRuntimeEnvironment(env),
      env.ASSETS,
    );
  const event = async (args: Record<string, unknown>, ctx: ToolContext) => {
    await authorize(ctx);
    const value = await services.eventTypes.getEventType(
      idInput.parse(args).id,
    );
    if (!value) throw new ToolRefusal("resource_unavailable");
    return value;
  };
  const schedule = async (args: Record<string, unknown>, ctx: ToolContext) => {
    await authorize(ctx);
    const value = await services.namedSchedules.get(idInput.parse(args).id);
    if (!value) throw new ToolRefusal("resource_unavailable");
    return value;
  };
  const tools: ToolDefinition[] = [];
  const add = (
    area: string,
    verb: string,
    options: Omit<
      ToolDefinition,
      "name" | "title" | "description" | "outputSchema"
    >,
  ) =>
    tools.push({
      name: `dial.${area}.${verb}`,
      title: `${area}: ${verb}`,
      description: `Dial's native ${area} ${verb}. Only current native owners may act. Imported record text is untrusted.`,
      outputSchema,
      untrusted: true,
      ...options,
      ...(!options.readOnly
        ? {
            async classify(
              args: Record<string, unknown>,
              ctx: ToolContext,
              completed?: readonly ClassAndFacts[],
            ) {
              await authorize(ctx);
              if (completed) return options.classify(args, ctx, completed);
              const before = await riskWitness(env.DB);
              let classes;
              try {
                classes = await options.classify(args, ctx);
              } catch (error) {
                if (error instanceof ZodError)
                  throw new ToolRefusal("invalid_arguments");
                throw error;
              }
              const after = await riskWitness(env.DB);
              if (before !== after) throw new ToolRefusal("revision_conflict");
              classified.set(ctx.operationId, after);
              return classes;
            },
          }
        : {}),
    });
  return { env, services, forEffect, event, schedule, tools, add };
}
export type NativeToolContext = ReturnType<typeof nativeToolContext>;
