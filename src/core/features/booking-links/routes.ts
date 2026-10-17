import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { createBookingLinkSchema } from "./types";
export const bookingLinkRoutes = new Hono<AppEnvironment>()
  .get("/api/app/booking-links", async context => context.json(await context.get("services").bookingLinks.list()))
  .post("/api/app/booking-links", validate("json", createBookingLinkSchema), async context => {
    const services = context.get("services"), profile = await services.hostProfile.getProfile();
    if (!profile) return apiError(context,409,"profile_required","Configure your host profile first.");
    const result = await services.bookingLinks.create(context.req.valid("json"));
    if (result.kind === "invalid_expiry") return apiError(context,400,"invalid_expiry","Choose a future expiry date.");
    if (result.kind === "not_found") return apiError(context,404,"event_not_available","Choose an available event type.");
    if (result.kind === "not_ready") return apiError(context,409,"event_not_ready",`This link is not ready: ${result.missing.join(", ")}.`,result.missing);
    const url = new URL(`/book/${profile.handle}/${result.slug}`,context.get("runtime").APP_URL);
    url.searchParams.set("link",result.token);
    return context.json({ id: result.id, url: url.href },201);
  })
  .post("/api/app/booking-links/:id/revoke", validate("param",z.object({id:z.string().regex(/^[0-9A-Z]{26}$/)})),async context => {
    const result = await context.get("services").bookingLinks.revoke(context.req.valid("param").id);
    return result ? context.json({revoked:true}) : apiError(context,404,"link_not_found","This link is not available.");
  });
