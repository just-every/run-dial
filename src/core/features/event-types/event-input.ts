import { z } from "zod";
import { hostDateSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";
import { locationTypes, locationIssue, offeredLocations, type EventLocationOption } from "./locations";
import { postBookingRedirectSchema, validateEventRedirect } from "./redirect-validation";
import { defaultEventQuestions } from "./defaults";
import { validateGroupShape } from "../group-events";

const optionSchema = z.object({ value: z.string().min(1).max(120), label: z.string().min(1).max(200) });
const questionSchema = z
  .object({
    key: z.string().regex(/^q_[A-Za-z0-9_-]{10,80}$/).optional(),
    kind: z.enum(["text", "textarea", "phone", "dropdown", "single_choice", "multiple_choice", "checkbox"]),
    label: z.string().min(1).max(500),
    required: z.boolean(),
    private: z.boolean().default(false),
    options: z.array(optionSchema).max(50),
  })
  .superRefine((question, context) => {
    const choice = ["single_choice", "dropdown", "multiple_choice", "checkbox"].includes(question.kind);
    if (choice && question.options.length === 0) context.addIssue({ code: "custom", path: ["options"], message: "Choice questions need at least one option." });
    if (!choice && question.options.length > 0) context.addIssue({ code: "custom", path: ["options"], message: "Text questions cannot have options." });
    if (new Set(question.options.map((option) => option.value)).size !== question.options.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Give each choice different “saved as” text." });
    }
  });

export const recurringAvailabilitySchema = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), ...timeWindowSchema.shape }))
  .max(1000)
  .superRefine((availability, context) => {
    for (const weekday of new Set(availability.map((window) => window.weekday))) {
      validateNonOverlappingWindows(availability.filter((window) => window.weekday === weekday), context, [weekday]);
    }
  });

export const eventTypeInputSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(4000),
    durationMinutes: z.number().int().min(5).max(480),
    groupCapacity: z.number().int().min(2).max(1000).nullable().optional(),
    durationOptionsMinutes: z.array(z.number().int().min(5).max(480)).min(1).max(4).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    locationType: z.enum(locationTypes),
    locations: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), type: z.enum(locationTypes), label: z.string().trim().min(1).max(180), value: z.string().max(1000), prompt: z.string().trim().max(500).optional() })).min(1).max(8).optional(),
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
    postBookingRedirect: postBookingRedirectSchema,
    questions: z.array(questionSchema).max(25).superRefine((questions, context) => {
      const keys = questions.flatMap((question) => question.key ? [question.key] : []);
      if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "Question keys must be unique." });
    }),
    availability: recurringAvailabilitySchema,
  })
  .superRefine(requirePrivateLocation).superRefine(validateEventRedirect).superRefine(validateGroupShape);

export const eventDetailsInputSchema = z.object({ ...eventTypeInputSchema.shape, availability: z.never().optional(), alternativeRequestsEnabled: z.never().optional() }).superRefine(requirePrivateLocation).superRefine(validateEventRedirect).superRefine(validateGroupShape);
// A new event uses your hours unless `hours` (or windows in the weekly `availability` the API has always taken) gives its own.
const newEventHoursSchema = z.union([z.object({ uses: z.literal("yours") }).strict(), z.object({ uses: z.literal("own"), windows: recurringAvailabilitySchema }).strict()]);
export const eventTypeCreationSchema = z.object({ ...eventTypeInputSchema.shape, questions: eventTypeInputSchema.shape.questions.default(defaultEventQuestions), availability: recurringAvailabilitySchema.optional(), hours: newEventHoursSchema.optional() })
  .superRefine(requirePrivateLocation).superRefine(validateEventRedirect).superRefine(validateGroupShape)
  .superRefine((input, context) => { if (input.hours && input.availability?.length) context.addIssue({ code: "custom", path: ["hours"], message: "Give the event's hours once, as hours or as availability." }); });

function requirePrivateLocation(input: { durationMinutes: number; durationOptionsMinutes?: number[]; locationType: typeof locationTypes[number]; locationLabel: string; locationValue: string; locations?: EventLocationOption[]; bookingHorizonMode?: string; bookingStartDate?: string | null; bookingEndDate?: string | null }, context: z.RefinementCtx) {
  if (input.durationOptionsMinutes && (new Set(input.durationOptionsMinutes).size !== input.durationOptionsMinutes.length || !input.durationOptionsMinutes.includes(input.durationMinutes))) context.addIssue({ code: "custom", path: ["durationOptionsMinutes"], message: "Choose distinct durations and include the default duration." });
  if (input.bookingHorizonMode === "fixed_range") {
    if (!input.bookingStartDate) context.addIssue({ code: "custom", path: ["bookingStartDate"], message: "Choose the first bookable date." });
    if (!input.bookingEndDate || (input.bookingStartDate && input.bookingEndDate < input.bookingStartDate)) context.addIssue({ code: "custom", path: ["bookingEndDate"], message: "Choose an end date on or after the first date." });
  }
  const options = offeredLocations(input);
  if (new Set(options.map(location => location.id)).size !== options.length) context.addIssue({ code: "custom", path: ["locations"], message: "Location keys must be unique." });
  options.forEach((location, index) => { const message = locationIssue(location); if (message) context.addIssue({ code: "custom", path: input.locations ? ["locations", index] : ["locationValue"], message }); });
}
