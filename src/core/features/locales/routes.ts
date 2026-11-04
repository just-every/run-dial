import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { confirmationLanguageSchema } from "./configuration";

const eventId = z.object({ id: z.string().length(26) });
export const confirmationLanguageRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/confirmation-language", validate("param", eventId), async context => {
    const result = await context.get("services").confirmationLanguages.read(context.req.valid("param").id);
    return result ? context.json(result) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  })
  .put("/api/app/event-types/:id/confirmation-language", validate("param", eventId), validate("json", confirmationLanguageSchema), async context => {
    const result = await context.get("services").confirmationLanguages.save(context.req.valid("param").id, context.req.valid("json"), nowIso());
    return result ? context.json(result) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  });
