import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ClassAndFacts, JsonSchema, JsonSchemaObject, ToolContext, ToolDefinition } from "../../modules/agent-door/types.ts";
import { requireNativeOwner } from "../core/features/operators/authority";

export type { ClassAndFacts, ToolContext } from "../../modules/agent-door/types.ts";
export const standard = (items = 1): ClassAndFacts[] => [{ class: "standard", facts: { measure: items } }];
export const live = (service: string): ClassAndFacts => ({ class: "live", facts: { measure: 1, service } });
export const external = (recipients: number, counterparty: "internal" | "known" | "new" | "public" = "known"): ClassAndFacts => ({ class: "external", facts: { measure: recipients, counterparty } });

type Definition<T extends z.ZodType> = Omit<ToolDefinition, "inputSchema" | "run" | "classify" | "summary" | "revision" | "authority"> & {
  input: T;
  run(args: z.output<T>, ctx: ToolContext): ReturnType<ToolDefinition["run"]>;
  classify(args: z.output<T>, ctx: ToolContext): ReturnType<ToolDefinition["classify"]>;
  summary?: (args: z.output<T>, ctx: ToolContext) => ReturnType<NonNullable<ToolDefinition["summary"]>>;
  revision?: (args: z.output<T>, ctx: ToolContext) => ReturnType<NonNullable<ToolDefinition["revision"]>>;
  authority?: "none" | ((args: z.output<T>, ctx: ToolContext) => ReturnType<Exclude<ToolDefinition["authority"], string | undefined>>);
};

export function nativeTool<T extends z.ZodType>(definition: Definition<T>): ToolDefinition {
  const { input, run, classify, summary, revision, authority, ...rest } = definition;
  const parsed = (args: Record<string, unknown>) => {
    const result = input.safeParse(args);
    if (!result.success) throw new ToolRefusal("invalid_arguments");
    return result.data;
  };
  const check = async (ctx: ToolContext) => {
    try { await requireNativeOwner(ctx.db, ctx.person.id); }
    catch { throw new ToolRefusal("role_forbidden"); }
  };
  const inputSchema = z.toJSONSchema(input, { io: "input", unrepresentable: "any" }) as JsonSchemaObject;
  delete inputSchema.$schema;
  return {
    ...rest, inputSchema,
    async classify(args, ctx) { await check(ctx); return classify(parsed(args), ctx); },
    async run(args, ctx) { await check(ctx); return run(parsed(args), ctx); },
    ...(summary ? { summary: async (args: Record<string, unknown>, ctx: ToolContext) => { await check(ctx); return summary(parsed(args), ctx); } } : {}),
    ...(revision ? { revision: async (args: Record<string, unknown>, ctx: ToolContext) => { await check(ctx); return revision(parsed(args), ctx); } } : {}),
    ...(authority === "none" ? { authority } : authority ? { authority: async (args: Record<string, unknown>, ctx: ToolContext) => { await check(ctx); return authority(parsed(args), ctx); } } : {}),
  };
}

export function required<T>(record: T | undefined | null): T {
  if (record === undefined || record === null) throw new ToolRefusal("not_found");
  return record;
}

export const objectOutput: JsonSchema = { type: "object" };
export const arrayOutput: JsonSchema = { type: "array", items: { type: "object" } };
