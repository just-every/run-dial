import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const email = z.string().trim().toLowerCase().max(320).email();
const domain = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Enter a domain such as example.com (no @ or URL).");
const rule = z.discriminatedUnion("kind", [z.object({ kind: z.literal("email"), value: email }), z.object({ kind: z.literal("domain"), value: domain })]);
const ruleId = z.object({ id: z.string().length(26) });

export const publicAbuseRoutes = new Hono<AppEnvironment>()
  .get("/api/app/blocked-addresses", async (context) => context.json({ rules: await context.get("services").publicAbuse.list() }))
  .post("/api/app/blocked-addresses", validate("json", rule), async (context) => {
    const input = context.req.valid("json");
    const added = await context.get("services").publicAbuse.add(input.kind, input.value, context.get("session").id);
    if (!added) return apiError(context, 503, "blocking_rule_unavailable", "The rule changed before it could be read. Reload the rules and retry.");
    return context.json(added, 201);
  })
  .delete("/api/app/blocked-addresses/:id", validate("param", ruleId), async (context) => {
    const removed = await context.get("services").publicAbuse.remove(context.req.valid("param").id);
    return removed ? context.body(null, 204) : apiError(context, 404, "blocking_rule_not_found", "This rule no longer exists.");
  });
