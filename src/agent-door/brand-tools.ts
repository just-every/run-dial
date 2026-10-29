import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { SiteLookRepository } from "../core/features/site-look/repository";
import { SiteLookError } from "../core/features/site-look/service";
import { live,nativeTool,objectOutput,standard,type ToolContext } from "./native-tool";

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase()).nullable().optional();
const change = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  line: z.string().trim().min(1).max(280).nullable().optional(),
  background: colour, ink: colour, accent: colour, buttonInk: colour,
  mark: z.enum(["site", "none"]).optional(), face: z.enum(["site", "plain"]).optional(), look: z.enum(["site", "plain"]).optional(),
}).strict().refine(value => Object.keys(value).length > 0);
const current = (ctx: ToolContext) => new SiteLookRepository(ctx.db).get();
const revision = async (_args: unknown, ctx: ToolContext) => (await current(ctx))?.revision ?? 0;
async function nativeResult(work: () => Promise<unknown>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof SiteLookError) throw new ToolRefusal(error.code, error.message);
    throw error;
  }
}

export function brandTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.site_look.read", title: "Read stored site look", description: "Read the stored native website look, owner's changes, contrast adjustments, source and last-read result. Performs no website fetch.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["BRAND-001"], untrusted: true,
      classify: () => standard(0), run: async () => ({ result: await services.siteLook.state() }),
    }),
    nativeTool({
      name: "dial.site_look.change", title: "Change booking page look", description: "Change native stored branding values, hide the mark, select plain type or switch site/plain look. Null restores a value from the site's read. Requires a successful previous site read except selecting plain by itself.",
      scope: "dial:write", readOnly: false, input: change, outputSchema: objectOutput, classes: ["live"], clauses: ["BRAND-001"],
      classify: () => [live("public booking page branding")], revisionType: "integer", revision,
      summary: async args => ({ target: { name: "Public booking page branding" }, items: Object.entries(args).map(([key, value]) => `${key}: ${value === null ? "restore site value" : value}`) }),
      async run(args, ctx) {
        const result = await nativeResult(() => services.siteLook.change(args));
        ctx.emit("dial.site_look.changed", "dial://site-look", { actorLabel: ctx.actor.label });
        return { result };
      },
    }),
    nativeTool({
      name: "dial.site_look.clear", title: "Clear stored site look", description: "Forget the native site read and hand edits, delete retained brand files, and restore plain public booking pages.",
      scope: "dial:write", readOnly: false, input: z.object({}).strict(), outputSchema: objectOutput, classes: ["standard", "live", "destructive"], clauses: ["BRAND-001"],
      classify: async (_args, ctx) => {
        const stored = await current(ctx);
        return stored ? [live("public booking page branding"), { class: "destructive", facts: { measure: 1 + Number(Boolean(stored.markAsset)) + Number(Boolean(stored.fontAsset)) } }] : standard(0);
      },
      revisionType: "integer", revision,
      summary: async (_args, ctx) => {
        const stored = await current(ctx);
        return { target: { name: "Public booking page branding" }, items: ["Forget the stored site read and hand edits and use plain booking pages", ...(stored?.websiteUrl ? [`Stored site: ${stored.websiteUrl}`] : []), "Remove retained brand files"] };
      },
      async run(_args, ctx) {
        const result = await nativeResult(() => services.siteLook.clear());
        ctx.emit("dial.site_look.cleared", "dial://site-look", { actorLabel: ctx.actor.label });
        return { result };
      },
    }),
  ];
}
