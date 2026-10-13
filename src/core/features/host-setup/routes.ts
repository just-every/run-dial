import { setupSteps } from "./steps";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

export const hostSetupRoutes = new Hono<AppEnvironment>()
  .get("/api/app/host-setup", async (context) => {
    const services = context.get("services");
    const [state, calendar, mail] = await Promise.all([services.hostSetup.read(), services.calendar.connectionHealth(), services.delivery.mailHealth()]);
    return context.json({ ...state, calendar, mail, steps: setupSteps(state, calendar, mail) });
  })
  .post("/api/app/host-setup/complete", async (context) => {
    const origin = new URL(context.get("runtime").APP_URL).origin;
    if (context.req.header("Origin") !== origin || context.req.header("sec-fetch-site") === "cross-site") return apiError(context, 403, "origin_not_allowed", "Finish setup from this install's operator workspace.");
    const result = await context.get("services").hostSetup.complete();
    return result.kind === "completed" ? context.json(result) : apiError(context, 409, "setup_not_ready", "Save a valid profile, publish or Open requests, and copy the current booking link. Connection checks must pass when finishing.", result.missing);
  })
  .post("/api/app/event-types/:id/copy-report", async (context, next) => {
    const origin = new URL(context.get("runtime").APP_URL).origin;
    if (context.req.header("Origin") !== origin || context.req.header("sec-fetch-site") === "cross-site" || context.req.header("X-Dial-Copy-Report") !== "1") return apiError(context, 403, "origin_not_allowed", "Copy the booking link from this install's operator workspace.");
    await next();
  }, validate("param", z.object({ id: z.string().length(26) })), validate("json", z.object({ url: z.string().url().max(2048) }).strict()), async (context) => {
    const result = await context.get("services").hostSetup.reportCopy(context.req.valid("param").id, context.req.valid("json").url);
    if (result.kind === "recorded") return context.json(result.report);
    return apiError(context, result.kind === "event_not_found" ? 404 : 409, result.kind, "This booking link changed or is not public. Open the event type and copy its current link.", ["event_configuration_changed"]);
  });
