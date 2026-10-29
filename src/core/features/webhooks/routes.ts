import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const subscription = z.object({ endpoint: z.string().url().max(2048), events: z.array(z.string().max(100)).min(1).max(20), scope: z.enum(["workspace", "host", "team"]), scopeId: z.string().max(128).nullable() }).strict();
const id = z.object({ id: z.string().min(1).max(128) });
const privateResponse: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  context.header("Cache-Control", "no-store");
  const session = await context.get("services").operators.auth.getSession(context.req.raw);
  if (session?.operator.role !== "owner") return apiError(context, 403, "role_forbidden", "Only a workspace owner can manage webhook delivery.");
  await next();
};
export const webhookRoutes = new Hono<AppEnvironment>()
  .use("/api/app/webhooks", privateResponse)
  .use("/api/app/webhooks/:id", privateResponse)
  .use("/api/app/webhook-deliveries/:id/redeliver", privateResponse)
  .get("/api/app/webhooks", async c => c.json(await c.get("services").webhooks.subscriptions.status()))
  .post("/api/app/webhooks", validate("json", subscription), async c => {
    try {
      const result = await c.get("services").webhooks.subscriptions.create(c.req.valid("json"));
      return result ? c.json(result, 201) : apiError(c, 400, "invalid_webhook_scope", "Choose existing event types and a scope in this workspace.");
    } catch { return apiError(c, 400, "endpoint_not_public_https", "Use a public HTTPS endpoint without credentials or redirects to private addresses."); }
  })
  .delete("/api/app/webhooks/:id", validate("param", id), async c => await c.get("services").webhooks.subscriptions.remove(c.req.valid("param").id) ? c.json({ deleted: true }) : apiError(c, 404, "not_found", "Subscription not found."))
  .post("/api/app/webhook-deliveries/:id/redeliver", validate("param", id), async c => await c.get("services").webhooks.subscriptions.redeliver(c.req.valid("param").id) ? c.json({ queued: true }) : apiError(c, 404, "not_found", "Delivery is unavailable or still in progress."));
