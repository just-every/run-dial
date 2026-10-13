import { Hono } from "hono";
import { admissionResponse } from "../../platform/public-admission";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const calendarSelectionSchema = z.object({
  destinationCalendarId: z.string().min(1).max(1_024),
  conflictCalendarIds: z.array(z.string().min(1).max(1_024)).min(1).max(10),
});

const callbackSchema = z.object({ state: z.string().min(1).max(4_096).optional(), code: z.string().min(1).max(4_096).optional() });

export const calendarConnectionRoutes = new Hono<AppEnvironment>()
  .get("/api/app/calendar/setup", (context) => context.json(context.get("services").calendar.setupGuide()))
  .get("/api/app/calendar/connection", async (context) => context.json(await context.get("services").calendar.connectionHealth()))
  .get("/api/app/calendar/oauth/start", async (context) => {
    const redirect = await context.get("services").calendar.beginAuthorization(context.get("session"));
    return redirect ? context.redirect(redirect, 302) : apiError(context, 503, "calendar_not_configured", "Google Calendar is not configured for this deployment.");
  })
  .get("/api/calendar/oauth/callback", validate("query", callbackSchema), async (context) => {
    const query = context.req.valid("query");
    const result = await context.get("services").calendar.completeAuthorization({
      state: query.state,
      code: query.code,
      session: await context.get("services").operators.authenticate(context.req.raw),
    });
    if (result.kind === "invalid_state") return apiError(context, 400, "invalid_calendar_oauth_state", "The calendar connection could not be verified.");
    if (result.kind === "provider_failure") return apiError(context, 503, "calendar_oauth_failed", "Google Calendar did not accept this connection.");
    return context.redirect(await context.get("services").hostSetup.completion() ? "/app/settings?calendar=connected" : "/setup/settings?calendar=connected", 302);
  })
  .get("/api/app/calendar/calendars", async (context) => {
    const result = await context.get("services").calendar.listCalendars();
    return result.kind === "ok" ? context.json({ calendars: result.calendars }) : apiError(context, 503, "calendar_unavailable", "Calendar data cannot be read right now.");
  })
  .put("/api/app/calendar/selection", validate("json", calendarSelectionSchema), async (context) => {
    const result = await context.get("services").calendar.selectCalendars(context.req.valid("json"));
    if (result.kind === "saved") return context.json(result.health);
    if (result.kind === "invalid_selection") return apiError(context, 400, "invalid_calendar_selection", "Select one writable destination and at least one readable conflict calendar.");
    return apiError(context, 503, "calendar_unavailable", "Calendar data cannot be read right now.");
  })
  .post("/api/app/calendar/check", async (context) => {
    const result = await context.get("services").calendar.checkConnection();
    return result.kind === "healthy" ? context.json(result) : apiError(context, 503, "calendar_unavailable", "Calendar data cannot be read right now.");
  })
  .delete("/api/app/calendar/connection", async (context) => {
    await context.get("services").calendar.disconnect();
    return context.body(null, 204);
  })
  .post("/api/webhooks/google-calendar", async (context) => {
    const result = await context.get("services").calendar.receiveGoogleWebhook(context.req.raw.headers, () => context.get("admitProvider")("google_calendar"));
    if (result.kind === "rate_limited") return admissionResponse({ kind: "limited", retryAfterSeconds: result.retryAfterSeconds })!;
    return result.kind === "unauthorized" ? apiError(context, 401, "invalid_provider_callback", "Provider callback authentication failed.") : context.body(null, 204);
  });
