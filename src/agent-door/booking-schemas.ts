import { z } from "zod";
import { hostDateSchema, ianaTimeZoneSchema } from "../core/shared/scheduling";
import { hasSupportedInstantPrecision } from "../core/shared/instants";

export const bookingId = z.object({ id: z.string().length(26) }).strict();
export const bookingInstant = z.string().datetime({ offset: true })
  .refine(hasSupportedInstantPrecision, "Use an instant with at most millisecond precision.")
  .refine(value => Number.isFinite(Date.parse(value)), "Use a valid instant.")
  .transform(value => new Date(value).toISOString());

/** The native operator list rules, without the HTTP string encoding of booleans. */
export const bookingList = z.object({
  attendance: z.enum(["attended", "no_show", "unmarked"]).optional(),
  rescheduleRequest: z.enum(["open", "picked", "expired", "cancelled"]).optional(),
  state: z.enum(["confirmed", "cancelled", "rescheduled"]).optional(),
  time: z.enum(["future", "past"]).optional(),
  eventTypeId: z.string().length(26).optional(),
  from: bookingInstant.optional(), fromDate: hostDateSchema.optional(),
  throughDate: hostDateSchema.optional(), to: bookingInstant.optional(),
  order: z.literal("created").optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  deliveryFailed: z.boolean().optional(), query: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((input, context) => {
  if (input.fromDate && input.throughDate && input.fromDate > input.throughDate)
    context.addIssue({ code: "custom", path: ["throughDate"], message: "The end must follow the start." });
  if ((input.fromDate || input.throughDate) && (input.from || input.to))
    context.addIssue({ code: "custom", path: ["fromDate"], message: "Choose host dates or instant boundaries." });
  if (input.from && input.to && input.from > input.to)
    context.addIssue({ code: "custom", path: ["to"], message: "The end must follow the start." });
});

export const bookingCreate = z.object({
  idempotencyKey: z.string().uuid().optional(), requestId: z.string().length(26).optional(),
  eventTypeId: z.string().length(26), locationId: z.string().max(80).optional(),
  locationInput: z.string().max(1000).optional(), durationMinutes: z.number().int().min(5).max(480).optional(),
  startAt: bookingInstant, inviteeTimezone: ianaTimeZoneSchema,
  name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(320),
  answers: z.record(z.string().max(100), z.union([z.string().max(4_000), z.array(z.string().max(500)).max(50)])),
  overrideNoticeAndHorizon: z.boolean().default(false),
}).strict();

export const cancellation = bookingId.extend({
  reason: z.string().trim().max(500).optional(),
  refund: z.object({ amountCents: z.number().int().min(0).max(99_999_999), reason: z.string().trim().min(1).max(500) }).strict().optional(),
});
export const reschedule = bookingId.extend({
  durationMinutes: z.number().int().min(5).max(480).optional(), startAt: bookingInstant,
  inviteeTimezone: ianaTimeZoneSchema, reason: z.string().trim().max(500).optional(),
  overridePublishedAvailability: z.boolean().default(false),
});
export const newTimeRequest = bookingId.extend({
  message: z.string().trim().max(1000).default(""), releaseTime: z.boolean(),
  expiresInDays: z.number().int().min(1).max(30).default(14),
  reminderHours: z.number().int().min(1).max(168).nullable().default(null),
});
