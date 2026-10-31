import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { operatorListSchema, resolveOperatorBookingQuery } from "../bookings";
import { bookingCsv } from "./booking-csv";

const periodSchema = z.object({ fromDate: hostDateSchema.optional(), throughDate: hostDateSchema.optional(), eventTypeId: z.string().length(26).optional() }).strict();

/** Build after feature imports settle: bookings also uses the report drill-through service. */
export function reportRoutes() {
  return new Hono<AppEnvironment>()
  .get("/api/app/reports/bookings.csv", validate("query", operatorListSchema), async context => {
    const services = context.get("services");
    const query = await resolveOperatorBookingQuery(services, context.req.valid("query"));
    if (query.kind !== "filters") return reportRefusal(context, query.kind);
    const rows = await services.bookings.exportForOperator(query.filters);
    context.header("Content-Type", "text/csv; charset=utf-8");
    context.header("Content-Disposition", 'attachment; filename="bookings.csv"');
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    if (query.timezone) context.header("X-Host-Timezone", query.timezone);
    return context.body(bookingCsv(rows));
  })
  .get("/api/app/reports/scheduling", validate("query", periodSchema), async context => {
    const result = await context.get("services").reports.report(context.req.valid("query"));
    if (result.kind === "report") return context.json(result.report);
    return reportRefusal(context, result.kind);
  });
}

export function reportRefusal(context: Parameters<typeof apiError>[0], kind: "host_profile_required" | "invalid_period" | "period_too_long") {
  if (kind === "host_profile_required") return apiError(context, 409, kind, "Set up the host profile before running the scheduling report.");
  return apiError(context, 400, kind, kind === "invalid_period" ? "The end of the period must not precede its start." : "Choose a period of at most one year.");
}
