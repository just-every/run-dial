import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { exceptionQuerySchema, exceptionRequestSchema } from "./input";

/** Mounted behind native owner-session middleware; times carry no booking authority. */
export const exceptionProposalRoutes = new Hono<AppEnvironment>()
  .get("/api/app/availability-requests/:id/exception-proposals", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    await next();
  }, validate("param", exceptionRequestSchema), validate("query", exceptionQuerySchema), async context => {
    const result = await context.get("services").exceptionProposals.read(context.req.valid("param").id);
    if (result.kind === "not_found") return apiError(context, 404, "availability_request_not_found", "This submitted alternative-time request is not available.");
    if (result.kind === "resolved") return apiError(context, 409, "availability_request_resolved", "This alternative-time request has already been resolved.");
    if (result.kind === "unsupported") return apiError(context, 409, "exception_proposals_unsupported", "Advisory exceptions support ordinary free single-host events with one fixed duration and location, without calendars, approval, guests or group seats.");
    if (result.kind === "host_hours_required") return apiError(context, 409, "host_hours_required", "Explicitly save Your hours before reading advisory exception times.");
    if (result.kind === "unavailable") return apiError(context, 503, "availability_unavailable", "Current availability constraints could not be read.");
    return context.json(result.result);
  });
