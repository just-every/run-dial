import { attributionSchema } from "../bookings";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { hostDateSchema, ianaTimeZoneSchema } from "../../shared/scheduling";

const handleSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const eventSchema = handleSchema.extend({ slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const recoverySchema = z.object({ token: z.string().min(1).max(512) });
const availabilityQuerySchema = z.object({ link:z.string().max(200).optional(), week: hostDateSchema.optional(), inviteeTimezone: ianaTimeZoneSchema.optional(), durationMinutes: z.coerce.number().int().min(5).max(480).optional() });
const selectionSchema = z.object({ link:z.string().max(200).optional(), startAt: z.string().datetime({ offset: true }), inviteeTimezone: ianaTimeZoneSchema, durationMinutes: z.number().int().min(5).max(480).optional() });
// Capability recovery must answer 404 for an absent or incomplete query, before
// parsing selection values that an unauthorised caller is not entitled to validate.
const selectionLookupSchema = z.object({
  link:z.string().max(200).optional(),
  nonce: z.string().min(1).max(200).optional(),
  startAt: z.string().optional(),
  inviteeTimezone: z.string().optional(),
});
const confirmedLookupSchema = z.object({ token: z.string().min(1).max(512).optional() });
const answerValueSchema = z.union([z.string().max(4_000), z.array(z.string().max(500)).max(50)]);
const confirmationSchema = selectionSchema.extend({ locationId:z.string().max(80).optional(),locationInput:z.string().max(1000).optional(), nonce: z.string().max(200).optional(), name: z.string().max(160), email: z.string().max(320), answers: z.record(z.string().max(100), answerValueSchema), attribution: attributionSchema.optional(),
  // PAY-003: the invitee's explicit agreement to a saved card for the stated fees, with the wording version shown.
  cardConsent: z.object({ accepted: z.boolean(), version: z.string().max(40) }).strict().optional() });
const manageRescheduleSchema = selectionSchema.extend({ nonce: z.string().max(200).optional(), reason: z.string().trim().max(500).optional() });
const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const availabilityResponseSchema = z.object({
  state: z.literal("temporarily_unavailable"),
  provider: z.literal("calendar_provider_unavailable"),
  slots: z.array(z.never()),
});

export const publicBookingRoutes = new Hono<AppEnvironment>()
  .get("/api/public/book/:handle/:slug/availability", validate("param", eventSchema), validate("query", availabilityQuerySchema.optional()), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const query = context.req.valid("query") ?? {};
    const result = await context.get("services").availability.listPublicWeek(handle, slug, query.week, query.inviteeTimezone, new Date(), query.durationMinutes, query.link);
    if (!result) return apiError(context, 404, "event_not_available", "This event type is not publicly available.");
    if ("kind" in result) return result.kind === "invalid_duration" ? invalidDuration(context) : apiError(context,410,result.kind,result.kind === "link_used" ? "This link has already been used." : "This booking link has expired.");
    return context.json(result);
  })
  .post("/api/public/book/:handle/:slug/selection", validate("param", eventSchema), validate("json", selectionSchema), async (context) => {
    const result = await context.get("services").bookings.issuePublicSelection(context.req.valid("param").handle, context.req.valid("param").slug, context.req.valid("json").startAt, context.req.valid("json").inviteeTimezone, context.req.valid("json").durationMinutes, context.req.valid("json").link);
    return selectionResult(context, result);
  })
  .get("/api/public/book/:handle/:slug/selection", validate("param", eventSchema), validate("query", selectionLookupSchema), async (context) => {
    const query = context.req.valid("query");
    const result = await context.get("services").bookings.getPublicSelection({ ...context.req.valid("param"), link:query.link, nonce: query.nonce ?? "", startAt: query.startAt ?? "", inviteeTimezone: query.inviteeTimezone ?? "" });
    if (result.kind === "found") return context.json(result.selection);
    return result.kind === "expired"
      ? apiError(context, 410, "booking_nonce_expired", "This booking selection has expired. Choose a new time.")
      : apiError(context, 404, "booking_nonce_not_found", "This booking selection is not valid.");
  })
  .post("/api/public/book/:handle/:slug/confirm", validate("param", eventSchema), validate("json", confirmationSchema), async (context) => {
    const body = context.req.valid("json");
    const result = await context.get("services").bookings.confirmPublic({ ...body, handle: context.req.valid("param").handle, slug: context.req.valid("param").slug, nonce: body.nonce ?? "" });
    return confirmationResult(context, result);
  })
  .get("/api/public/manage/:token", validate("param", recoverySchema), async (context) => {
    const result = await context.get("services").bookings.getManageBooking(context.req.valid("param").token);
    if (result.kind === "found") return context.json(result.booking);
    return result.kind === "expired"
      ? apiError(context, 410, "manage_token_expired", "This management link has expired. Start a new booking or contact the host.")
      : apiError(context, 404, "manage_token_not_found", "This management link is not valid.");
  })
  .post("/api/public/manage/:token/contact-host", validate("param", recoverySchema), validate("json", z.object({ idempotencyKey: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/), message: z.string().trim().max(1000).optional() }).strict()), async context => {
    const body = context.req.valid("json");
    const result = await context.get("services").bookings.contactHost(context.req.valid("param").token, body.idempotencyKey, body.message);
    if (result.kind === "sent") return context.json({ sent: true });
    if (result.kind === "contact_unavailable") return apiError(context, 503, "contact_host_unavailable", "Contact messages need a mail provider that supports replies. The current managed relay does not support Reply-To.");
    return result.kind === "expired" ? apiError(context, 410, "manage_token_expired", "This management link has expired.") : apiError(context, 404, "manage_token_not_found", "This management link is not valid.");
  })
  .get("/api/public/manage/:token/calendar.ics", validate("param", recoverySchema), async (context) => {
    const result = await context.get("services").bookings.getCalendarFile(context.req.valid("param").token);
    if (result.kind === "found") {
      context.header("Content-Type", "text/calendar; charset=utf-8");
      context.header("Content-Disposition", "attachment; filename=booking.ics");
      return context.body(result.ics);
    }
    return result.kind === "expired"
      ? apiError(context, 410, "manage_token_expired", "This management link has expired. Start a new booking or contact the host.")
      : apiError(context, 404, "manage_token_not_found", "This management link is not valid.");
  })
  .get("/api/public/manage/:token/reschedule/availability", validate("param", recoverySchema), validate("query", availabilityQuerySchema.strict()), async (context) => {
    const { week, inviteeTimezone, durationMinutes } = context.req.valid("query");
    const result = await context.get("services").bookings.getRescheduleAvailability(context.req.valid("param").token, week, inviteeTimezone, durationMinutes);
    if (result.kind === "invalid_duration") return invalidDuration(context);
    if (result.kind === "found") return context.json(result.availability);
    if (result.kind === "expired") return apiError(context, 410, "manage_token_expired", "This management link has expired. Start a new booking or contact the host.");
    if (result.kind === "policy_blocked") return apiError(context, 409, "reason" in result && typeof result.reason === "string" ? result.reason : "reschedule_window_closed", "This booking can no longer be rescheduled online.");
    return apiError(context, 404, "manage_token_not_found", "This management link is not valid.");
  })
  .post("/api/public/manage/:token/reschedule/selection", validate("param", recoverySchema), validate("json", selectionSchema), async (context) => {
    const result = await context.get("services").bookings.issueRescheduleSelection(context.req.valid("param").token, context.req.valid("json").startAt, context.req.valid("json").inviteeTimezone, context.req.valid("json").durationMinutes);
    return selectionResult(context, result);
  })
  .post("/api/public/manage/:token/reschedule", validate("param", recoverySchema), validate("json", manageRescheduleSchema), async (context) => {
    const body = context.req.valid("json");
    const result = await context.get("services").bookings.rescheduleByManageToken({ ...body, token: context.req.valid("param").token, nonce: body.nonce ?? "" });
    return rescheduleResult(context, result);
  })
  .post("/api/public/manage/:token/cancel", validate("param", recoverySchema), validate("json", cancelSchema), async (context) => {
    const result = await context.get("services").bookings.cancelByManageToken(context.req.valid("param").token, context.req.valid("json").reason);
    if (result.kind === "cancelled") return context.json(result.booking);
    if (result.kind === "expired") return apiError(context, 410, "manage_token_expired", "This management link has expired. Start a new booking or contact the host.");
    if (result.kind === "policy_blocked") return apiError(context, 409, "reason" in result && typeof result.reason === "string" ? result.reason : "cancellation_window_closed", "This booking can no longer be cancelled online.");
    return apiError(context, 404, "manage_token_not_found", "This management link is not valid.");
  })
  .get("/book/:handle/:slug/details", validate("param", eventSchema), validate("query", selectionLookupSchema), async (context) => {
    const query = context.req.valid("query");
    const result = await context.get("services").bookings.getPublicSelection({ ...context.req.valid("param"), link:query.link, nonce: query.nonce ?? "", startAt: query.startAt ?? "", inviteeTimezone: query.inviteeTimezone ?? "" });
    return result.kind === "found" ? publicSurface(context) : recoverySurface(context, undefined, result.kind === "expired" ? 410 : 404);
  })
  .get("/book/:handle/:slug/confirmed", validate("param", eventSchema), validate("query", confirmedLookupSchema), async (context) => {
    const result = await context.get("services").bookings.getPublicConfirmation({ ...context.req.valid("param"), token: context.req.valid("query").token ?? "" });
    return result.kind === "found" ? publicSurface(context) : recoverySurface(context, undefined, result.kind === "expired" ? 410 : 404);
  })
  .get("/book/:handle/:slug/request", validate("param", eventSchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    return (await knownAlternativeRequestEvent(context, handle, slug)) ? publicSurface(context) : recoverySurface(context);
  })
  .get("/book/:handle/:slug", validate("param", eventSchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const offer = await context.get("services").bookingLinks.resolve(slug,context.req.query("link"));
    const profile = await context.get("services").hostProfile.getPublicProfile(handle);
    return profile && offer ? offer.kind === "expired" ? recoverySurface(context,undefined,offer.event.bookingLink?.kind === "one_off" ? 404 : 410) : publicSurface(context) : recoverySurface(context);
  })
  .get("/book/:handle", validate("param", handleSchema), async (context) => {
    return (await context.get("services").hostProfile.getPublicProfile(context.req.valid("param").handle))
      ? publicSurface(context)
      : recoverySurface(context);
  })
  .get("/book/*", (context) => recoverySurface(context))
  .get("/manage/:token", validate("param", recoverySchema), async (context) => {
    const result = await context.get("services").bookings.getManageBooking(context.req.valid("param").token);
    return result.kind === "found" ? publicSurface(context) : recoverySurface(context, undefined, result.kind === "expired" ? 410 : 404);
  })
  .get("/manage/*", (context) => recoverySurface(context))
  .get("/embed/*", (context) => recoverySurface(context, { blockFraming: true }))
  .get("/privacy", (context) => publicSurface(context));

async function knownAlternativeRequestEvent(context: Context<AppEnvironment>, handle: string, slug: string) {
  const profile = await context.get("services").hostProfile.getPublicProfile(handle);
  const eventType = await context.get("services").eventTypes.getPublicEvent(slug);
  return Boolean(profile && eventType?.alternativeRequestsEnabled);
}

async function publicSurface(context: Context<AppEnvironment>) {
  return context.get("services").spaSurface.serve(context.req.raw, 200, { blockFraming: true });
}

async function recoverySurface(context: Context<AppEnvironment>, options?: { blockFraming?: boolean }, status: 404 | 410 = 404) {
  return context.get("services").spaSurface.serve(context.req.raw, status, options);
}

function selectionResult(context: Context<AppEnvironment>, result: Awaited<ReturnType<AppEnvironment["Variables"]["services"]["bookings"]["issuePublicSelection"]>> | Awaited<ReturnType<AppEnvironment["Variables"]["services"]["bookings"]["issueRescheduleSelection"]>>) {
  if (result.kind === "invalid_duration") return invalidDuration(context);
  if (result.kind === "policy_blocked") return apiError(context, 409, result.reason ?? "reschedule_window_closed", "This booking can no longer be rescheduled online.");
  if (result.kind === "issued") return context.json(result.nonce, 201);
  if (result.kind === "not_found") return apiError(context, 404, "event_not_available", "This booking link is not available.");
  if (result.kind === "expired") return apiError(context, 410, "manage_token_expired", "This management link has expired. Start a new booking or contact the host.");
  if (result.kind === "calendar_unavailable") return context.json(availabilityResponseSchema.parse({ state: "temporarily_unavailable", provider: "calendar_provider_unavailable", slots: [] }), 503);
  if (result.kind === "invalid_timezone") return apiError(context, 400, "invalid_request", "Choose a valid IANA timezone.");
  if (result.kind === "payments_unavailable") return paymentsUnavailable(context, result.reason);
  return apiError(context, 409, "slot_unavailable", "That time is no longer available. Choose another time.");
}

function confirmationResult(context: Context<AppEnvironment>, result: Awaited<ReturnType<AppEnvironment["Variables"]["services"]["bookings"]["confirmPublic"]>>) {
  if (result.kind === "invalid_duration") return invalidDuration(context);
  if (result.kind === "created") return context.json(result.booking, 201);
  // PAY-001: the slot is held; the booking confirms only on Stripe's signed event.
  if (result.kind === "payment_required") return context.json({ paymentRequired: true, payment: result.payment }, 202);
  if (result.kind === "payments_unavailable") return paymentsUnavailable(context, result.reason);
  if (result.kind === "replayed") return context.json(result.booking);
  if (result.kind === "invalid_answers") return apiError(context, 400, "invalid_answers", "Review the required booking details.");
  if (result.kind === "card_consent_required") return apiError(context, 400, "card_consent_required", "Agree to the saved card and the stated fees to book this event.", ["cardConsent"]);
  if (result.kind === "invalid_nonce") return apiError(context, 404, "booking_nonce_not_found", "This booking selection is not valid.");
  if (result.kind === "expired_nonce") return apiError(context, 410, "booking_nonce_expired", "This booking selection has expired. Choose a new time.");
  if (result.kind === "calendar_unavailable") return context.json(availabilityResponseSchema.parse({ state: "temporarily_unavailable", provider: "calendar_provider_unavailable", slots: [] }), 503);
  if (result.kind === "payload_mismatch") return apiError(context, 409, "booking_replay_mismatch", "This booking selection was already used with different details.");
  if (result.kind === "blocked") return apiError(context, 409, "booking_unavailable", "This booking cannot be confirmed. Contact the host directly.");
  return apiError(context, 409, result.kind === "slot_taken" ? "slot_taken" : "slot_unavailable", "That time is no longer available. Choose another time.");
}

function rescheduleResult(context: Context<AppEnvironment>, result: Awaited<ReturnType<AppEnvironment["Variables"]["services"]["bookings"]["rescheduleByManageToken"]>>) {
  if (result.kind === "invalid_duration") return invalidDuration(context);
  if (result.kind === "rescheduled" || result.kind === "replayed") return context.json(result.booking);
  if (result.kind === "not_found" || result.kind === "invalid_nonce") return apiError(context, 404, "booking_nonce_not_found", "This booking selection is not valid.");
  if (result.kind === "expired" || result.kind === "expired_nonce") return apiError(context, 410, "booking_nonce_expired", "This booking selection has expired. Choose a new time.");
  if (result.kind === "policy_blocked") return apiError(context, 409, "reason" in result && typeof result.reason === "string" ? result.reason : "reschedule_window_closed", "This booking can no longer be rescheduled online.");
  if (result.kind === "calendar_unavailable") return context.json(availabilityResponseSchema.parse({ state: "temporarily_unavailable", provider: "calendar_provider_unavailable", slots: [] }), 503);
  if (result.kind === "payload_mismatch") return apiError(context, 409, "booking_replay_mismatch", "This booking selection was already used with different details.");
  return apiError(context, 409, result.kind === "slot_taken" ? "slot_taken" : "slot_unavailable", "That time is no longer available. Choose another time.");
}

function paymentsUnavailable(context: Context<AppEnvironment>, reason: string) {
  return apiError(context, 503, "payments_unavailable", "Payments for this event are unavailable right now. No booking was made; contact the host.", [reason]);
}

function invalidDuration(context: Context<AppEnvironment>) {
  return apiError(context, 400, "invalid_duration", "Choose a duration offered by this event.", ["durationMinutes"]);
}
