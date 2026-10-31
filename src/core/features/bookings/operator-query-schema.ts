import { z } from "zod";
import { hostDateSchema } from "../../shared/scheduling";
import { hasSupportedInstantPrecision } from "../../shared/instants";
import { reportTileKeys } from "../reports/client";
import { bookingPaymentStates } from "./payment-state-filter";

export const instantSchema = z.string().datetime({ offset: true })
  .refine(hasSupportedInstantPrecision, "Use an instant with at most millisecond precision.")
  .refine((value) => Number.isFinite(Date.parse(value)), "Use a valid instant.")
  .transform((value) => new Date(value).toISOString());
export const operatorListSchema = z.object({
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
