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
  .get("/api/app/calendar/connection", async (context) => context.json({ ...await context.get("services").calendar.connectionHealth(), recentChanges: await context.get("services").calendar.recentHealthChanges() }))
  .get("/api/app/calendar/oauth/start", async (context) => {
    const provider = context.req.query("provider") ?? "google";
    if (provider !== "google" && provider !== "microsoft") return apiError(context, 400, "invalid_calendar_provider", "Choose a supported calendar provider.");
    const redirect = await context.get("services").calendar.beginAuthorization(context.get("session"), provider);
    return redirect ? context.redirect(redirect, 302) : apiError(context, 503, "calendar_not_configured", "Calendar OAuth is not configured for this provider. Microsoft requires MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET.");
  })
  .get("/api/calendar/oauth/callback", validate("query", callbackSchema), async (context) => {
    const query = context.req.valid("query");
    const result = await context.get("services").calendar.completeAuthorization({
      state: query.state,
      code: query.code,
      session: await context.get("services").operators.authenticate(context.req.raw),
    });
    if (result.kind === "invalid_state") return apiError(context, 400, "invalid_calendar_oauth_state", "The calendar connection could not be verified.");
    if (result.kind === "provider_failure" && result.code === "calendar_provider_switch_blocked") return apiError(context, 409, result.code, "Cancel existing managed bookings and complete their calendar work before changing calendar providers.");
    if (result.kind === "provider_failure") return apiError(context, 503, "calendar_oauth_failed", "The calendar provider did not accept this connection.");
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
    const microsoft = context.req.query("provider") === "microsoft";
    const validation = context.req.query("validationToken");
    if (microsoft && validation && validation.length <= 4096) return context.text(validation, 200, { "Cache-Control": "no-store" });
    let body: unknown;
    if (microsoft) { try { body = await context.req.json(); } catch { return apiError(context, 400, "invalid_provider_callback", "Expected Graph notifications."); } }
    const admit = () => context.get("admitProvider")("google_calendar");
    const result = microsoft ? await context.get("services").calendar.receiveMicrosoftWebhook(body, admit) : await context.get("services").calendar.receiveGoogleWebhook(context.req.raw.headers, admit);
    if (result.kind === "rate_limited") return admissionResponse({ kind: "limited", retryAfterSeconds: result.retryAfterSeconds })!;
    return result.kind === "unauthorized" ? apiError(context, 401, "invalid_provider_callback", "Provider callback authentication failed.") : context.body(null, 204);
  });
