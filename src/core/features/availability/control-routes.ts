import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { closureFields, scheduleInputSchema } from "./schedule-input";
import { bookingLimitsSchema } from "./booking-limits";

const id = z.object({ id: z.string().length(26) });
const scope = z.object({ scope: z.union([z.literal("host"), z.string().length(26)]) });
const hoursChoice = z.union([
  z.object({ uses: z.literal("own"), startFrom: z.union([z.literal("yours"), z.string().length(26)]).optional() }).strict(),
  z.object({ uses: z.union([z.literal("yours"), z.string().length(26)]) }).strict(),
]);
const closuresRefused = (context: Context, fields: string[]) => apiError(context, 400, "invalid_request", "Holidays and time off belong to your hours, which every event uses.", fields);

export const availabilityControlRoutes = new Hono<AppEnvironment>()
  .get("/api/app/hours", async context => context.json(await context.get("services").yourHours.read()))
  .get("/api/app/availability-schedules", async context => context.json(await context.get("services").namedSchedules.list()))
  .post("/api/app/availability-schedules", validate("json", scheduleInputSchema), async context => {
    const input = context.req.valid("json"), closures = closureFields(input);
    if (closures.length) return closuresRefused(context, closures);
    return context.json(await context.get("services").namedSchedules.save(input), 201);
  })
  .put("/api/app/availability-schedules/:id", validate("param", id), validate("json", scheduleInputSchema), async context => {
    const schedules = context.get("services").namedSchedules, input = context.req.valid("json");
    const schedule = await schedules.get(context.req.valid("param").id);
    if (!schedule) return apiError(context, 404, "schedule_not_found", "The schedule does not exist.");
    const closures = closureFields(input);
    if (!schedule.isDefault && closures.length) return closuresRefused(context, closures);
    return context.json(await schedules.save(input, schedule.id));
  })
  .put("/api/app/event-types/:id/hours", validate("param", id), validate("json", hoursChoice), async context => {
    const services = context.get("services"), eventId = context.req.valid("param").id;
    const result = await services.yourHours.choose(eventId, context.req.valid("json"));
    if (result === "event_not_found") return apiError(context, 404, "event_not_found", "The event type does not exist.");
    if (result === "schedule_not_found") return apiError(context, 404, "schedule_not_found", "The schedule does not exist.", ["uses"]);
    if (result === "start_not_found") return apiError(context, 404, "event_not_found", "The event to start from does not exist.", ["startFrom"]);
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
