import { Hono } from "hono";
import { toPublicEventType } from "./public";
import { z } from "zod";
import { isPaid } from "../payments";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { toPublicProfile } from "../host-profile";
import { eventDetailsInputSchema, eventTypeCreationSchema, eventTypeInputSchema, recurringAvailabilitySchema } from "./event-input";

const idSchema = z.object({ id: z.string().min(26).max(26) });
const availabilityOverrideParamSchema = idSchema.extend({ hostDate: hostDateSchema });
const dateAvailabilityOverrideBodySchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("closed"), windows: z.array(timeWindowSchema).length(0) }),
    z.object({ mode: z.literal("open"), windows: z.array(timeWindowSchema).min(1).max(1000) }),
  ])
  .superRefine((override, context) => validateNonOverlappingWindows(override.windows, context, ["windows"]));
const publicEventSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/), slug: z.string().regex(/^[a-z0-9-]+$/) });

export const eventTypeRoutes = new Hono<AppEnvironment>()
  .get("/api/app/event-types/:id/approval",validate("param",idSchema),async context=>{const settings=await context.get("services").bookings.approvalSettings(context.req.valid("param").id);return settings?context.json(settings):apiError(context,404,"not_found","Event type not found.");})
  .put("/api/app/event-types/:id/approval",validate("param",idSchema),validate("json",z.object({required:z.boolean(),windowHours:z.number().int().min(1).default(24)}).strict()),async context=>{const result=await context.get("services").bookings.saveApprovalSettings(context.req.valid("param").id,context.req.valid("json"));return result.kind==="saved"?context.json(result.settings):apiError(context,result.kind==="not_found"?404:409,result.kind,result.kind==="approval_window_too_long"?"Approval must be decided within 7 days.":"Priced approval cannot also require a saved card for fees.");})
  .get("/api/app/event-types/:id/guests",validate("param",idSchema),async context=>{ const settings=await context.get("services").bookings.guestSettings(context.req.valid("param").id); return settings?context.json(settings):apiError(context,404,"not_found","Event type not found."); })
  .put("/api/app/event-types/:id/guests",validate("param",idSchema),validate("json",z.object({guestLimit:z.number().int().min(0).max(20)}).strict()),async context=>{ const guestLimit=context.req.valid("json").guestLimit; return await context.get("services").bookings.saveGuestSettings(context.req.valid("param").id,guestLimit)?context.json({guestLimit}):apiError(context,404,"not_found","Event type not found."); })
    .post("/api/app/event-types/:id/open-requests", validate("param", idSchema), async (context) => {
      const result = await context.get("services").eventTypes.openRequests(context.req.valid("param").id);
      if (result.kind === "published") return context.json(result.eventType);
      return apiError(context, result.kind === "event_not_found" ? 404 : 409, result.kind, "Open requests requires a saved host profile, a draft or disabled event with alternative requests enabled, and a verified mail sender.", result.kind === "not_ready" ? result.readiness.missing : ["event_not_found"]);
    })
    .get("/api/public/events/:handle/:slug", validate("param", publicEventSchema), validate("query",z.object({link:z.string().max(200).optional()}).optional()), async (context) => {
      const { handle, slug } = context.req.valid("param");
      const profile = await context.get("services").hostProfile.getPublicProfile(handle);
      if (!profile) return apiError(context, 404, "profile_not_found", "The requested public profile does not exist.");
      const offer = await context.get("services").bookingLinks.resolve(slug,context.req.valid("query")?.link);
      if (offer?.kind === "used") return context.json({linkState:"used" as const});
      if (offer?.kind === "expired") return apiError(context,offer.event.bookingLink?.kind === "one_off" ? 404 : 410,"link_expired","This booking link has expired.");
      const eventType = offer ? toPublicEventType(offer.event) : undefined;
      if (!eventType) return apiError(context, 404, "event_not_available", "This event type is not publicly available.");
      // PAY-001: a paid event shows its USD price, or the price of each offered duration.
      const price = await context.get("services").payments.eventPrice(offer!.event.id);
      return context.json({ profile: toPublicProfile(profile), eventType: isPaid(price) ? { ...eventType, price } : eventType });
    })
    .get("/api/app/event-types", async (context) => context.json(await context.get("services").eventTypes.listEventTypes()))
    .post("/api/app/event-types", validate("json", eventTypeCreationSchema), async (context) => context.json(await context.get("services").eventTypes.createEventType(context.req.valid("json")), 201))
    .post("/api/app/event-types/:id/duplicate", validate("param", idSchema), async context => {
      const event = await context.get("services").eventTypes.duplicateEventType(context.req.valid("param").id);
      return event ? context.json(event, 201) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .get("/api/app/event-types/:id", validate("param", z.object({ id: z.string().min(1).max(200) })), async (context) => {
      const eventType = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
      return eventType ? context.json(eventType) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .patch("/api/app/event-types/:id/details", validate("param", idSchema), validate("json", eventDetailsInputSchema), async (context) => {
      const config = await context.get("services").correspondence.read(context.req.valid("param").id);
      if (config && !context.get("services").correspondence.validateQuestions(config, context.req.valid("json").questions).success) return apiError(context, 400, "template_question_in_use", "Edit invitation and email templates before removing a referenced question or making its calendar answer private.");
      const event = await context.get("services").eventTypes.updateEventDetails(context.req.valid("param").id, context.req.valid("json"));
      return event ? context.json(event) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .patch("/api/app/event-types/:id/alternative-requests", validate("param", idSchema), validate("json", z.object({ enabled: z.boolean() }).strict()), async (context) => {
      const event = await context.get("services").eventTypes.setAlternativeRequests(context.req.valid("param").id, context.req.valid("json").enabled);
      return event ? context.json(event) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .get("/api/app/event-types/:id/readiness", validate("param", idSchema), async (context) => {
      const services = context.get("services");
      const id = context.req.valid("param").id;
      let readiness = await services.eventTypes.getReadiness(id);
      // Only an install whose sender was never checked waits for the scheduled pass's check here.
      if (readiness?.recorded === "unrecorded") {
        await services.delivery.reconcileConnections();
        readiness = await services.eventTypes.getReadiness(id);
      } else if (readiness?.recorded === "stale") context.executionCtx.waitUntil(services.delivery.reconcileConnections());
      return readiness ? context.json(readiness) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .put("/api/app/event-types/:id/availability", validate("param", idSchema), validate("json", z.object({ windows: recurringAvailabilitySchema }).strict()), async (context) => {
      const event = await context.get("services").eventTypes.replaceRecurringAvailability(context.req.valid("param").id, context.req.valid("json").windows);
      return event ? context.json(event) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .get("/api/app/event-types/:id/preview", validate("param", idSchema), async (context) => {
      const eventType = await context.get("services").eventTypes.getEventTypePreview(context.req.valid("param").id);
      const profile = await context.get("services").hostProfile.getProfile();
      if (!eventType || !profile) return apiError(context, 404, "event_not_found", "The event type does not exist.");
      return context.json({ profile, eventType });
    })
    .get("/api/app/event-types/:id/availability-overrides", validate("param", idSchema), async (context) => {
      const overrides = await context.get("services").eventTypes.listDateAvailabilityOverrides(context.req.valid("param").id);
      return overrides ? context.json(overrides) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .put(
      "/api/app/event-types/:id/availability-overrides/:hostDate",
      validate("param", availabilityOverrideParamSchema),
      validate("json", dateAvailabilityOverrideBodySchema),
      async (context) => {
        const { id, hostDate } = context.req.valid("param");
        const result = await context.get("services").eventTypes.replaceDateAvailabilityOverride(id, { hostDate, ...context.req.valid("json") });
        return dateAvailabilityOverrideResult(context, result);
      },
    )
    .delete("/api/app/event-types/:id/availability-overrides/:hostDate", validate("param", availabilityOverrideParamSchema), async (context) => {
      const { id, hostDate } = context.req.valid("param");
      const result = await context.get("services").eventTypes.deleteDateAvailabilityOverride(id, hostDate);
      if (result === "deleted") return context.body(null, 204);
      if (result === "event_not_found" || result === "not_found") return apiError(context, 404, "availability_override_not_found", "The date availability override does not exist.");
      if (result === "override_in_past") return apiError(context, 409, "availability_override_in_past", "Past host dates cannot be changed.");
      return apiError(context, 409, "profile_not_configured", "Configure a valid host timezone before editing availability overrides.");
    })
    .patch("/api/app/event-types/:id", validate("param", idSchema), validate("json", eventTypeInputSchema), async (context) => {
      const config = await context.get("services").correspondence.read(context.req.valid("param").id);
      if (config && !context.get("services").correspondence.validateQuestions(config, context.req.valid("json").questions).success) return apiError(context, 400, "template_question_in_use", "Edit invitation and email templates before removing a referenced question or making its calendar answer private.");
      const eventType = await context.get("services").eventTypes.updateEventType(context.req.valid("param").id, context.req.valid("json"));
      return eventType ? context.json(eventType) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .post("/api/app/event-types/:id/disable", validate("param", idSchema), async (context) => {
      const eventType = await context.get("services").eventTypes.disableEventType(context.req.valid("param").id);
      return eventType ? context.json(eventType) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .delete("/api/app/event-types/:id", validate("param", idSchema), async (context) => {
      const deleted = await context.get("services").eventTypes.deleteEventType(context.req.valid("param").id);
      return deleted ? context.body(null, 204) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .post("/api/app/event-types/:id/publish", validate("param", idSchema), async (context) => {
      const result = await context.get("services").eventTypes.publishEventType(context.req.valid("param").id);
      if (result.kind === "published") return context.json(result.eventType);
      if (result.kind === "event_not_found") return apiError(context, 404, "event_not_found", "The event type does not exist.", ["event_not_found"]);
      return apiError(context, 409, "event_not_ready", "This event cannot be published until the named requirements are configured.", result.readiness.missing);
    });

function dateAvailabilityOverrideResult(
  context: Parameters<typeof apiError>[0],
  result: Awaited<ReturnType<AppEnvironment["Variables"]["services"]["eventTypes"]["replaceDateAvailabilityOverride"]>>,
) {
  if (result.kind === "saved") return context.json(result.override);
  if (result.kind === "event_not_found") return apiError(context, 404, "event_not_found", "The event type does not exist.");
  if (result.kind === "override_in_past") return apiError(context, 409, "availability_override_in_past", "Past host dates cannot be changed.");
  if (result.kind === "invalid_override") return apiError(context, 400, "invalid_request", "The date availability override is invalid.");
  return apiError(context, 409, "profile_not_configured", "Configure a valid host timezone before editing availability overrides.");
}
