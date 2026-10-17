import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { toPublicProfile } from "../host-profile";
import { defaultEventQuestions } from "./defaults";

const optionSchema = z.object({ value: z.string().min(1).max(120), label: z.string().min(1).max(200) });
const questionSchema = z
  .object({
    key: z.string().regex(/^q_[A-Za-z0-9_-]{10,80}$/).optional(),
    kind: z.enum(["text", "textarea", "phone", "dropdown", "single_choice", "multiple_choice", "checkbox"]),
    label: z.string().min(1).max(500),
    required: z.boolean(),
    options: z.array(optionSchema).max(50),
  })
  .superRefine((question, context) => {
    const choice = ["single_choice", "dropdown", "multiple_choice", "checkbox"].includes(question.kind);
    if (choice && question.options.length === 0) context.addIssue({ code: "custom", path: ["options"], message: "Choice questions need at least one option." });
    if (!choice && question.options.length > 0) context.addIssue({ code: "custom", path: ["options"], message: "Text questions cannot have options." });
    if (new Set(question.options.map((option) => option.value)).size !== question.options.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option values must be stable and unique." });
    }
  });

const recurringAvailabilitySchema = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), ...timeWindowSchema.shape }))
  .max(1000)
  .superRefine((availability, context) => {
    for (const weekday of new Set(availability.map((window) => window.weekday))) {
      validateNonOverlappingWindows(availability.filter((window) => window.weekday === weekday), context, [weekday]);
    }
  });

const eventTypeInputSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(4000),
    durationMinutes: z.number().int().min(5).max(480),
    durationOptionsMinutes: z.array(z.number().int().min(5).max(480)).min(1).max(4).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    locationType: z.enum(["google_meet", "fixed_link", "phone", "in_person"]),
    locationLabel: z.string().min(1).max(180),
    locationValue: z.string().max(1000),
    listed: z.boolean(),
    alternativeRequestsEnabled: z.boolean(),
    slotIncrementMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
    minimumNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60),
    bookingHorizonDays: z.number().int().min(1).max(365),
    bookingHorizonMode: z.enum(["calendar_days", "weekdays", "fixed_range", "indefinite"]).default("calendar_days"),
    bookingStartDate: hostDateSchema.nullable().default(null),
    bookingEndDate: hostDateSchema.nullable().default(null),
    beforeBufferMinutes: z.number().int().min(0).max(120),
    afterBufferMinutes: z.number().int().min(0).max(120),
    hostDayBookingLimit: z.number().int().positive().nullable(),
    questions: z.array(questionSchema).max(25).superRefine((questions, context) => {
      const keys = questions.flatMap((question) => question.key ? [question.key] : []);
      if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Question keys must be unique." });
    }),
    availability: recurringAvailabilitySchema,
  })
  .superRefine(requirePrivateLocation);

const eventDetailsInputSchema = z.object({ ...eventTypeInputSchema.shape, availability: z.never().optional(), alternativeRequestsEnabled: z.never().optional() }).superRefine(requirePrivateLocation);
const eventTypeCreationSchema = z.object({ ...eventTypeInputSchema.shape, questions: eventTypeInputSchema.shape.questions.default(defaultEventQuestions) }).superRefine(requirePrivateLocation);

function requirePrivateLocation(input: { durationMinutes: number; durationOptionsMinutes?: number[]; locationType: string; locationValue: string; bookingHorizonMode?: string; bookingStartDate?: string | null; bookingEndDate?: string | null }, context: z.RefinementCtx) {
  if (input.durationOptionsMinutes && (new Set(input.durationOptionsMinutes).size !== input.durationOptionsMinutes.length || !input.durationOptionsMinutes.includes(input.durationMinutes))) context.addIssue({ code: "custom", path: ["durationOptionsMinutes"], message: "Choose distinct durations and include the default duration." });
  if (input.bookingHorizonMode === "fixed_range") {
    if (!input.bookingStartDate) context.addIssue({ code: "custom", path: ["bookingStartDate"], message: "Choose the first bookable date." });
    if (!input.bookingEndDate || (input.bookingStartDate && input.bookingEndDate < input.bookingStartDate)) context.addIssue({ code: "custom", path: ["bookingEndDate"], message: "Choose an end date on or after the first date." });
  }
  if (input.locationType !== "google_meet" && input.locationValue.trim().length === 0) context.addIssue({ code: "custom", path: ["locationValue"], message: "This location needs its private value." });
}

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
    .post("/api/app/event-types/:id/open-requests", validate("param", idSchema), async (context) => {
      const result = await context.get("services").eventTypes.openRequests(context.req.valid("param").id);
      if (result.kind === "published") return context.json(result.eventType);
      return apiError(context, result.kind === "event_not_found" ? 404 : 409, result.kind, "Open requests requires a saved host profile, a draft or disabled event with alternative requests enabled, and a verified mail sender.", result.kind === "not_ready" ? result.readiness.missing : ["event_not_found"]);
    })
    .get("/api/public/events/:handle/:slug", validate("param", publicEventSchema), async (context) => {
      const { handle, slug } = context.req.valid("param");
      const profile = await context.get("services").hostProfile.getPublicProfile(handle);
      if (!profile) return apiError(context, 404, "profile_not_found", "The requested public profile does not exist.");
      const eventType = await context.get("services").eventTypes.getPublicEvent(slug);
      return eventType ? context.json({ profile: toPublicProfile(profile), eventType }) : apiError(context, 404, "event_not_available", "This event type is not publicly available.");
    })
    .get("/api/app/event-types", async (context) => context.json(await context.get("services").eventTypes.listEventTypes()))
    .post("/api/app/event-types", validate("json", eventTypeCreationSchema), async (context) => context.json(await context.get("services").eventTypes.createEventType(context.req.valid("json")), 201))
    .post("/api/app/event-types/:id/duplicate", validate("param", idSchema), async context => {
      const event = await context.get("services").eventTypes.duplicateEventType(context.req.valid("param").id);
      return event ? context.json(event, 201) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .get("/api/app/event-types/:id", validate("param", idSchema), async (context) => {
      const eventType = await context.get("services").eventTypes.getEventType(context.req.valid("param").id);
      return eventType ? context.json(eventType) : apiError(context, 404, "event_not_found", "The event type does not exist.");
    })
    .patch("/api/app/event-types/:id/details", validate("param", idSchema), validate("json", eventDetailsInputSchema), async (context) => {
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
