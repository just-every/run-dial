import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";

const periodSchema = z.object({ fromDate: hostDateSchema.optional(), throughDate: hostDateSchema.optional(), eventTypeId: z.string().length(26).optional() }).strict();

export const reportRoutes = new Hono<AppEnvironment>()
  .get("/api/app/reports/scheduling", validate("query", periodSchema), async context => {
    const result = await context.get("services").reports.report(context.req.valid("query"));
    if (result.kind === "report") return context.json(result.report);
    return reportRefusal(context, result.kind);
  });

export function reportRefusal(context: Parameters<typeof apiError>[0], kind: "host_profile_required" | "invalid_period" | "period_too_long") {
  if (kind === "host_profile_required") return apiError(context, 409, kind, "Set up the host profile before running the scheduling report.");
  return apiError(context, 400, kind, kind === "invalid_period" ? "The end of the period must not precede its start." : "Choose a period of at most one year.");
}
