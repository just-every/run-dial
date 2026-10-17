import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { scheduleInputSchema } from "./schedule-input";
import { bookingLimitsSchema } from "./booking-limits";

const id = z.object({ id: z.string().length(26) });
const scope = z.object({ scope: z.union([z.literal("host"), z.string().length(26)]) });
export const availabilityControlRoutes = new Hono<AppEnvironment>()
  .get("/api/app/availability-schedules", async context => context.json(await context.get("services").namedSchedules.list()))
  .post("/api/app/availability-schedules", validate("json", scheduleInputSchema), async context => context.json(await context.get("services").namedSchedules.save(context.req.valid("json")), 201))
  .put("/api/app/availability-schedules/:id", validate("param", id), validate("json", scheduleInputSchema), async context => {
    const schedules = context.get("services").namedSchedules;
    if (!await schedules.get(context.req.valid("param").id)) return apiError(context, 404, "schedule_not_found", "The schedule does not exist.");
    return context.json(await schedules.save(context.req.valid("json"), context.req.valid("param").id));
  })
  .get("/api/app/event-types/:id/schedule", validate("param", id), async context => {
    const services = context.get("services"), eventId = context.req.valid("param").id;
    if (!await services.eventTypes.getEventType(eventId)) return apiError(context, 404, "event_not_found", "The event type does not exist.");
    return context.json({ schedule: await services.namedSchedules.forEvent(eventId) ?? null });
  })
  .put("/api/app/event-types/:id/schedule", validate("param", id), validate("json", z.object({ scheduleId: z.string().length(26).nullable() }).strict()), async context => {
    const services = context.get("services"), eventId = context.req.valid("param").id;
    if (!await services.namedSchedules.bind(eventId, context.req.valid("json").scheduleId)) return apiError(context, 404, "schedule_not_found", "The event or schedule does not exist.");
    return context.json((await services.eventTypes.getEventType(eventId))!);
  })
  .get("/api/app/booking-limits/:scope", validate("param", scope), async context => {
    const services = context.get("services"), key = context.req.valid("param").scope;
    if (key !== "host" && !await services.eventTypes.getEventType(key)) return apiError(context, 404, "event_not_found", "The event type does not exist.");
    return context.json(await services.bookingLimits.get(key));
  })
  .put("/api/app/booking-limits/:scope", validate("param", scope), validate("json", bookingLimitsSchema), async context => {
    const services = context.get("services"), key = context.req.valid("param").scope;
    if (key !== "host" && !await services.eventTypes.getEventType(key)) return apiError(context, 404, "event_not_found", "The event type does not exist.");
    return context.json(await services.bookingLimits.save(key, context.req.valid("json")));
  });
