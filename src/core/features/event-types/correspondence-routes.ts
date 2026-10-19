import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { correspondenceConfigSchema } from "../../shared/correspondence";
const id = z.object({ id: z.string().length(26) });
const body = z.object({ inviteeConfirmationEnabled: z.boolean().default(true), invitationManageLinkEnabled: z.boolean().default(true), templates: correspondenceConfigSchema().shape.templates }).strict();
export const correspondenceRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/correspondence", validate("param", id), async context => {
    const config = await context.get("services").correspondence.read(context.req.valid("param").id);
    return config ? context.json(config) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  })
  .put("/api/app/event-types/:id/correspondence", validate("param", id), validate("json", body), async context => {
    const repository = context.get("services").correspondence, eventId = context.req.valid("param").id;
    if (!await repository.read(eventId)) return apiError(context, 404, "event_not_found", "The event type does not exist.");
    const parsed = await repository.parse(eventId, context.req.valid("json"));
    if (!parsed.success) return apiError(context, 400, "invalid_template", parsed.error.issues.map(issue => issue.message).join(" "), parsed.error.issues.map(issue => issue.path.join(".")));
    if (!await repository.save(eventId, parsed.data, nowIso())) return apiError(context, 404, "event_not_found", "The event type does not exist.");
    return context.json(parsed.data);
  });
