import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateFilterBounds } from "./operator-date-filters";
import { hostDateSchema, ianaTimeZoneSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { hasSupportedInstantPrecision } from "../../shared/instants";
import { unavailableTimeMessage, type SlotExclusion } from "../availability";
import { reportRefusal } from "../reports";
import { reportTileKeys } from "../reports/client";
import { bookingPaymentStates } from "./payment-state-filter";

const bookingIdSchema = z.object({ id: z.string().length(26) });
const calendarConflictSchema = bookingIdSchema.extend({ conflictId: z.string().length(26) });
const instantSchema = z.string().datetime({ offset: true })
  .refine(hasSupportedInstantPrecision, "Use an instant with at most millisecond precision.")
  .refine((value) => Number.isFinite(Date.parse(value)), "Use a valid instant.")
  .transform((value) => new Date(value).toISOString());
const operatorListSchema = z.object({
  paymentState: z.enum(bookingPaymentStates).optional(),
  attendance: z.enum(["attended","no_show","unmarked"]).optional(),
  rescheduleRequest: z.enum(["open", "picked", "expired", "cancelled"]).optional(),
  state: z.enum(["confirmed", "cancelled", "rescheduled"]).optional(),
  time: z.enum(["future", "past"]).optional(),
  eventTypeId: z.string().length(26).optional(),
  from: instantSchema.optional(),
  fromDate: hostDateSchema.optional(),
  throughDate: hostDateSchema.optional(),
  to: instantSchema.optional(),
  order: z.enum(["created"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  deliveryFailed: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  query: z.string().trim().min(1).max(160).optional(),
  // A drill-through from the scheduling report (REPORT-001): the tile, its bucket and the report's period in host dates.
  report: z.enum(reportTileKeys).optional(),
  bucket: z.string().max(200).optional(),
  periodFrom: hostDateSchema.optional(),
  periodThrough: hostDateSchema.optional(),
}).superRefine((input, context) => {
  if (input.report && !(input.periodFrom && input.periodThrough)) context.addIssue({ code: "custom", path: ["periodFrom"], message: "A report drill-through names its period." });
  if (!input.report && (input.bucket || input.periodFrom || input.periodThrough)) context.addIssue({ code: "custom", path: ["report"], message: "A period or bucket belongs to a report tile." });
  if (input.fromDate && input.throughDate && input.fromDate > input.throughDate) context.addIssue({ code: "custom", path: ["throughDate"], message: "The end of the date range must follow its start." });
  if ((input.fromDate || input.throughDate) && (input.from || input.to)) context.addIssue({ code: "custom", path: ["fromDate"], message: "Choose either host dates or instant boundaries for the date range." });
  if (input.from && input.to && input.from > input.to) context.addIssue({ code: "custom", path: ["to"], message: "The end of the date range must follow its start." });
});
const operatorCreateSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  requestId: z.string().length(26).optional(),
  eventTypeId: z.string().length(26),
  locationId: z.string().max(80).optional(),
  locationInput: z.string().max(1000).optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  startAt: instantSchema,
  inviteeTimezone: ianaTimeZoneSchema,
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  answers: z.record(z.string().max(100), z.union([z.string().max(4_000), z.array(z.string().max(500)).max(50)])),
  overrideNoticeAndHorizon: z.boolean().default(false),
});
const cancellationSchema = z.object({ reason: z.string().trim().max(500).optional() });
/** PAY-003 (D4): an operator's cancellation refunds everything paid unless they choose less, or nothing, with a reason. */
const operatorCancellationSchema = cancellationSchema.extend({ refund: z.object({ amountCents: z.number().int().min(0).max(99_999_999), reason: z.string().trim().min(1).max(500) }).strict().optional() });
const deletionRetrySchema = z.object({ providerEventId: z.string().min(1).max(1024) }).strict();
const rescheduleSchema = z.object({ durationMinutes: z.number().int().min(5).max(480).optional(), startAt: instantSchema, inviteeTimezone: ianaTimeZoneSchema, reason: z.string().trim().max(500).optional(), overridePublishedAvailability: z.boolean().default(false) });
const attendanceSchema = z.object({ status: z.enum(["attended", "no_show"]), note: z.string().trim().max(4_000) });

/** Session-gated lifecycle endpoints. Booking IDs and delivery detail never cross this boundary. */
export const bookingOperatorRoutes = new Hono<AppEnvironment>()
  .get("/api/app/booking-approvals",async context=>context.json(await context.get("services").bookings.pendingApprovals()))
  .post("/api/app/booking-approvals/:id/decision",validate("param",bookingIdSchema),validate("json",z.object({decision:z.enum(["approve","decline"]),reason:z.string().trim().max(500).optional()}).strict()),async context=>{const result=await context.get("services").bookings.decideApproval(context.req.valid("param").id,context.get("session").id,context.req.valid("json").decision,context.req.valid("json").reason);return ["approved","declined","capture_pending","void_pending"].includes(result.kind)?context.json(result):apiError(context,result.kind==="not_found"?404:409,result.kind,"This request cannot be approved. Its deadline, event settings or availability may have changed.");})
  .post("/api/app/booking-approvals/:id/cancel",validate("param",bookingIdSchema),validate("json",cancellationSchema),async context=>{const result=await context.get("services").bookings.cancelApproval(context.req.valid("param").id,context.get("session").id,context.req.valid("json").reason);return ["approved","declined","capture_pending","void_pending"].includes(result.kind)?context.json(result):apiError(context,result.kind==="not_found"?404:409,result.kind,"This request cannot be cancelled.");})
  .post("/api/app/bookings/:id/reschedule-request", validate("param", bookingIdSchema), validate("json", z.object({ message:z.string().trim().max(1000).default(""),releaseTime:z.boolean(),expiresInDays:z.number().int().min(1).max(30).default(14),reminderHours:z.number().int().min(1).max(168).nullable().default(null) }).strict()), async context=> {
    const result=await context.get("services").bookings.requestReschedule(context.req.valid("param").id,context.get("session").id,context.req.valid("json"));
    if(result.kind==="created") return context.json(result.booking);
    return apiError(context,result.kind==="not_found"?404:409,result.kind,result.kind==="invalid_reminder"?"The reminder must be before expiry and, for a held time, before the original start.":"This booking cannot receive a new reschedule request. Check its state and existing request.");
  })
  .get("/api/app/bookings", validate("query", operatorListSchema), async (context) => {
    const services = context.get("services");
    const { fromDate, throughDate, report, bucket, periodFrom, periodThrough, ...filters } = context.req.valid("query");
    const profile = await services.hostProfile.getProfile();
    const drill = report ? await services.reports.members({ fromDate: periodFrom, throughDate: periodThrough, eventTypeId: filters.eventTypeId }, report, bucket) : undefined;
    if (drill && drill.kind !== "members") return reportRefusal(context, drill.kind);
    if ((fromDate || throughDate) && !profile) return apiError(context, 409, "host_profile_required", "Set up the host profile before filtering bookings by host date.");
    const bounds = profile ? hostDateFilterBounds(fromDate, throughDate, profile.timezone) : {};
    const { bookings, totalCount } = await services.bookings.listForOperatorWithCount({ ...filters, ...bounds, ...(drill ? { ids: drill.ids } : {}) });
    if (profile) context.header("X-Host-Timezone", profile.timezone);
    context.header("X-Total-Count", String(totalCount));
    return context.json(bookings);
  })
  .post("/api/app/bookings", validate("json", operatorCreateSchema), async (context) => {
    const body = context.req.valid("json");
    const input = { ...body, operatorId: context.get("session").id };
    const recover = async () => {
      const recovered = await context.get("services").bookings.recoverOperatorCreation(input);
      if (recovered?.kind === "replayed") return context.json(recovered.booking, 200);
      if (recovered) return createResult(context, recovered.kind);
      return undefined;
    };
    const recovered = await recover();
    if (recovered) return recovered;
    if (body.requestId) {
      const request = await context.get("services").availabilityRequests.getForOperator(body.requestId);
      if (!request) return await recover() ?? apiError(context, 404, "availability_request_not_found", "The alternative-time request does not exist.");
      if (request.state !== "submitted" || request.eventTypeId !== body.eventTypeId || request.inviteeEmail.toLowerCase() !== body.email.toLowerCase()) return await recover() ?? apiError(context, 409, "availability_request_not_eligible", "This alternative-time request cannot be linked to that booking.");
    }
    const result = await context.get("services").bookings.createForOperator(input);
    if (result.kind === "created" || result.kind === "replayed") return context.json(result.booking, result.kind === "created" ? 201 : 200);
    return createResult(context, result.kind, result.kind === "slot_invalid" ? result.exclusions : undefined);
  })
  .get("/api/app/bookings/:id", validate("param", z.object({ id: z.string().min(1).max(200) })), async (context) => {
    const booking = await context.get("services").bookings.getForOperator(context.req.valid("param").id);
    return booking ? context.json({ ...booking, customFields: await context.get("services").customFields.entries("booking", booking.id) }) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  })
  .post("/api/app/bookings/:id/release-imported", validate("param", bookingIdSchema), validate("json", cancellationSchema), async (context) => {
    const { id } = context.req.valid("param"), services = context.get("services");
    if (!await services.moveIn.releasable(id)) return apiError(context, 409, "release_not_available", "Only an imported booking cancelled at the source, with no decision yet, can be released.");
    const booking = await services.bookings.releaseImported(id, context.get("session").id, context.req.valid("json").reason || "Cancelled at the source scheduler, which already told the invitee; released in Dial without an email.");
    if (!booking) return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    await services.moveIn.released(id);
    return context.json(await services.bookings.getForOperator(id));
  })
  .post("/api/app/bookings/:id/cancel", validate("param", bookingIdSchema), validate("json", operatorCancellationSchema), async (context) => {
    const { reason, refund } = context.req.valid("json");
    const result = await context.get("services").bookings.cancelForOperator(context.req.valid("param").id, context.get("session").id, reason, refund);
    if (result.kind === "exceeds_refundable") return apiError(context, 400, "refund_exceeds_paid", `At most ${(result.refundableCents / 100).toFixed(2)} USD can be refunded.`, ["refund"]);
    return result.kind === "cancelled" ? context.json(result.booking) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  })
  .get("/api/app/bookings/:id/calendar-deletion/status", validate("param", bookingIdSchema), async (context) => {
    const probes = await context.get("services").bookings.calendarDeletionStatus(context.req.valid("param").id);
    return probes ? context.json({ probes }) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  })
  .post("/api/app/bookings/:id/calendar-deletion/retry", validate("param", bookingIdSchema), validate("json", deletionRetrySchema), async (context) => {
    const result = await context.get("services").bookings.retryCalendarDeletion(context.req.valid("param").id, context.req.valid("json").providerEventId);
    if (result === "retried") return context.body(null, 204);
    return apiError(context, result === "booking_not_found" ? 404 : 409, result, result === "booking_not_found" ? "The booking does not exist." : "Only a failed calendar reconciliation can be retried.");
  })
  .post("/api/app/bookings/:id/reschedule", validate("param", bookingIdSchema), validate("json", rescheduleSchema), async (context) => {
    const body = context.req.valid("json");
    const result = await context.get("services").bookings.rescheduleForOperator({ id: context.req.valid("param").id, operatorId: context.get("session").id, ...body });
    if (result.kind === "invalid_duration") return apiError(context, 400, "invalid_duration", "Choose a duration offered by this event.", ["durationMinutes"]);
    if (result.kind === "rescheduled") return context.json(result.booking);
    if (result.kind === "not_found") return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    if (result.kind === "invalid_timezone") return apiError(context, 400, "invalid_booking", "Choose a valid IANA timezone.");
    if (result.kind === "calendar_unavailable") return apiError(context, 503, "calendar_provider_unavailable", "Calendar availability is temporarily unavailable.");
    if (result.kind === "slot_invalid") return apiError(context, 409, "slot_unavailable", unavailableTimeMessage(result.exclusions), result.exclusions);
    return apiError(context, 409, result.kind === "slot_taken" ? "slot_taken" : "slot_unavailable", "That time is no longer available.");
  })
  .post("/api/app/bookings/:id/manage-link/rotate", validate("param", bookingIdSchema), async (context) => {
    const capability = await context.get("services").bookings.rotateManageTokenForOperator(context.req.valid("param").id);
    if (!capability) return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    return capability.kind === "rotated" ? context.json({ manageUrl: capability.manageUrl, expiresAt: capability.expiresAt }) : apiError(context, 410, "manage_token_expired", "This booking's manage-link lifetime has ended.");
  })
  .post("/api/app/bookings/:id/calendar-conflicts/:conflictId/restore", validate("param", calendarConflictSchema), async (context) => {
    const result = await context.get("services").bookings.restoreCalendarConflictForOperator(context.req.valid("param").id, context.req.valid("param").conflictId);
    if (result === "restored") return context.body(null, 204);
    const missing = ["booking_not_found", "calendar_conflict_not_found", "conflict_not_found"].includes(result);
    return apiError(context, missing ? 404 : 409, result, result === "booking_not_found" ? "The booking does not exist." : missing ? "The calendar conflict does not exist." : result === "booking_cancelled" ? "A cancelled booking cannot be restored." : "Only an open conflict for the current booking time can be restored.");
  })
  .post("/api/app/bookings/:id/attendance", validate("param", bookingIdSchema), validate("json", attendanceSchema), async (context) => {
    const result = await context.get("services").bookings.markAttendance(context.req.valid("param").id, context.get("session").id, context.req.valid("json").status, context.req.valid("json").note);
    if (result.kind === "not_found") return apiError(context, 404, "booking_not_found", "The booking does not exist.");
    if (result.kind === "not_ended") return apiError(context, 409, "booking_not_ended", "Attendance can be marked after the booking ends.");
    return context.json(result.booking);
  });

function createResult(context: Context<AppEnvironment>, kind: Exclude<Awaited<ReturnType<AppEnvironment["Variables"]["services"]["bookings"]["createForOperator"]>>["kind"], "created" | "replayed">, exclusions?: SlotExclusion[]) {
  if (kind === "invalid_duration") return apiError(context, 400, "invalid_duration", "Choose a duration offered by this event.", ["durationMinutes"]);
  if (kind === "attempt_erased") return apiError(context, 410, "booking_attempt_erased", "This booking was erased. Start a new booking to create another one.");
  if (kind === "payload_mismatch") return apiError(context, 409, "booking_attempt_changed", "The booking details changed. Start a new booking.");
  if (kind === "not_found") return apiError(context, 404, "event_not_found", "The event type does not exist.");
  if (kind === "invalid_timezone" || kind === "invalid_answers") return apiError(context, 400, "invalid_booking", "Review the invitee details and timezone.");
  if (kind === "calendar_unavailable") return apiError(context, 503, "calendar_provider_unavailable", "Calendar availability is temporarily unavailable.");
  if (kind === "slot_invalid" && exclusions?.length) return apiError(context, 409, "slot_unavailable", unavailableTimeMessage(exclusions), exclusions);
  if (kind === "blocked") return apiError(context, 409, "booking_unavailable", "This booking cannot be created. Contact the host directly.");
  return apiError(context, 409, kind === "slot_taken" ? "slot_taken" : "slot_unavailable", "That time is no longer available.");
}
