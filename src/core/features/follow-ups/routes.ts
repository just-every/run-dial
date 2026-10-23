import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
const id = z.object({ id: z.string().length(26) });
const settings = z.object({ enabled: z.boolean(), kind: z.enum(["thank_you", "rebooking", "feedback"]), text: z.string().trim().min(1).max(10000), offsetMinutes: z.number().int().min(1).max(43200), attendedOnly: z.boolean(), targetEventTypeId: z.string().length(26).nullable().default(null) }).strict().refine(value => value.kind === "rebooking" || value.targetEventTypeId === null, "Only a rebooking follow-up chooses another event.");
export const followUpRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/follow-up", validate("param", id), async context => {
    const result = await context.get("services").followUps.settings(context.req.valid("param").id); return result ? context.json(result) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  })
  .put("/api/app/event-types/:id/follow-up", validate("param", id), validate("json", settings), async context => {
    const result = await context.get("services").followUps.save(context.req.valid("param").id, context.req.valid("json"));
    return result.kind === "saved" ? context.json(context.req.valid("json")) : apiError(context, result.kind === "not_found" ? 404 : 400, result.kind, result.kind === "invalid_template" ? result.message : result.kind === "invalid_target" ? "Choose a published event type for rebooking." : "The event type does not exist.");
  })
  .get("/api/app/bookings/:id/follow-ups", validate("param", id), async context => {
    const result = await context.get("services").followUps.history(context.req.valid("param").id); return result ? context.json(result) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  });
