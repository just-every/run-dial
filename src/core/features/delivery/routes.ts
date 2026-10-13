import { z } from "zod";
import { validate } from "../../shared/validation";
import { Hono } from "hono";
import { admissionResponse } from "../../platform/public-admission";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";

const booking = z.object({ id: z.string().length(26) });
const retry = booking.extend({ deliveryId: z.string().length(26) });
const preferences = z.object({ bookingMailMuted: z.boolean() }).strict();

export const deliveryRoutes = new Hono<AppEnvironment>()
  .get("/api/app/mail/preferences", async (context) => context.json(await context.get("services").deliveryPreferences.get(context.get("session").id)))
  .put("/api/app/mail/preferences", validate("json", preferences), async (context) => context.json(await context.get("services").deliveryPreferences.set(context.get("session").id, context.req.valid("json").bookingMailMuted)))
  .get("/api/app/bookings/:id/deliveries", validate("param", booking), async (context) => context.json(await context.get("services").deliveryRecovery.list(context.req.valid("param").id)))
  .get("/api/app/erasures/:id/deliveries", validate("param", booking), async (context) => context.json(await context.get("services").deliveryRecovery.list(context.req.valid("param").id)))
  .post("/api/app/bookings/:id/deliveries/:deliveryId/retry", validate("param", retry), async (context) => {
    const input = context.req.valid("param");
    const result = await context.get("services").deliveryRecovery.retry(input.id, input.deliveryId);
    return result ? context.json(result, 202) : apiError(context, 409, "delivery_not_retryable", "Only a failed command for the current booking can be retried.");
  })
  .post("/api/app/erasures/:id/deliveries/:deliveryId/retry", validate("param", retry), async (context) => {
    const input = context.req.valid("param");
    const result = await context.get("services").deliveryRecovery.retry(input.id, input.deliveryId);
    return result ? context.json(result, 202) : apiError(context, 409, "delivery_not_retryable", "This cleanup command cannot be retried.");
  })
  .get("/api/app/mail/connection", async (context) => context.json(await context.get("services").delivery.mailHealth()))
  .post("/api/app/mail/check", async (context) => {
    const result = await context.get("services").delivery.checkMailConnection();
    return result.kind === "healthy"
      ? context.json({ state: "healthy", checkedAt: result.checkedAt, reason: null })
      : apiError(context, 503, "mail_unavailable", "Transactional mail could not be verified for this deployment.");
  })
  .post("/api/webhooks/sendgrid", async (context) => {
    const result = await context.get("services").sendgridWebhook.receive(context.req.raw, () => context.get("admitProvider")("sendgrid"));
    if (result.kind === "rate_limited") return admissionResponse({ kind: "limited", retryAfterSeconds: result.retryAfterSeconds })!;
    return result.kind === "unauthorized" ? apiError(context, 401, "invalid_provider_callback", "Provider callback authentication failed.") : context.body(null, 204);
  })
  .post("/api/webhooks/resend", async (context) => {
    const result = await context.get("services").delivery.receiveResendWebhook(context.req.raw, () => context.get("admitProvider")("resend"));
    if (result.kind === "rate_limited") return admissionResponse({ kind: "limited", retryAfterSeconds: result.retryAfterSeconds })!;
    return result.kind === "unauthorized" ? apiError(context, 401, "invalid_provider_callback", "Provider callback authentication failed.") : context.body(null, 204);
  });
