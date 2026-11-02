import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { recurringEventSchema, recurringPreviewSchema } from "./input";
import { previewWeeklySeries } from "./preview";

export const recurringPreviewRoutes = new Hono<AppEnvironment>()
  .get("/api/public/book/:handle/:slug/recurring-preview", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    await next();
  }, validate("param", recurringEventSchema), validate("query", recurringPreviewSchema), async context => {
    const { handle, slug } = context.req.valid("param");
    const result = await previewWeeklySeries(context.get("apiDatabase"), context.get("services"), handle, slug, context.req.valid("query"));
    if (result.kind === "not_found") return apiError(context, 404, "event_not_available", "This event type is not publicly available.");
    if (result.kind === "unsupported") return apiError(context, 409, "recurring_preview_unsupported", "Weekly previews support ordinary free single-host events with one fixed duration and location, without calendars, approval, guests or group seats.");
    if (result.kind === "invalid_time") return apiError(context, 400, "invalid_weekly_time", "Every proposed week must have a real local time.");
    if (result.kind === "unavailable") return apiError(context, 503, "availability_unavailable", "Availability is temporarily unavailable. Try the preview again.");
    return context.json({ occurrences: result.occurrences });
  });
