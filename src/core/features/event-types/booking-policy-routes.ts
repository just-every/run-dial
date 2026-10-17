import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { eventBookingPolicySchema } from "../../shared/booking-policy";

const id = z.object({ id: z.string().length(26) });
export const bookingPolicyRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/booking-policy", validate("param", id), async context => {
    const policy = await context.get("services").bookingPolicies.read(context.req.valid("param").id);
    return policy ? context.json(policy) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  })
  .put("/api/app/event-types/:id/booking-policy", validate("param", id), validate("json", eventBookingPolicySchema), async context => {
    const policy = await context.get("services").bookingPolicies.save(context.req.valid("param").id, context.req.valid("json"), nowIso());
    return policy ? context.json(policy) : apiError(context, 404, "event_not_found", "The event type does not exist.");
  });
