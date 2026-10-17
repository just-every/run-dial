import { hasSupportedInstantPrecision } from "../../shared/instants";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const eventSchema = z.object({ id: z.string().length(26) });
const querySchema = z.object({
  startAt: z.string().datetime().refine(hasSupportedInstantPrecision, "Use an instant with at most millisecond precision."),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  overrideNoticeAndHorizon: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});
/** Installed behind the existing /api/app/* native-session middleware. */
export const availabilityDiagnosticRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/availability-diagnostics", validate("param", eventSchema), validate("query", querySchema), async (context) => {
    const { startAt, overrideNoticeAndHorizon, durationMinutes } = context.req.valid("query");
    const result = await context.get("services").availability.diagnoseOperatorTime(context.req.valid("param").id, startAt, { overrideNoticeAndHorizon }, new Date(), durationMinutes);
    if (result.kind === "invalid_duration") return apiError(context, 400, "invalid_duration", "Choose a duration offered by this event type.");
    if (result.kind === "invalid_time") return apiError(context, 400, "invalid_time", "Use a valid UTC instant with at most millisecond precision.");
    if (result.kind === "not_found") return apiError(context, 404, "event_not_found", "The event type does not exist.");
    if (result.kind === "calendar_unavailable") return apiError(context, 503, "calendar_provider_unavailable", "Calendar availability is temporarily unavailable; exclusion rules could not be checked.");
    return context.json(result.diagnosis);
  });
