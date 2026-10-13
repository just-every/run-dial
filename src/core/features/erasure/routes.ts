import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
const idSchema = z.object({ id: z.string().length(26) });
export const erasureRoutes = new Hono<AppEnvironment>()
  .use("/api/app/*", async (c,next) => {
    if(c.req.method === "DELETE" && (c.req.header("Origin") !== new URL(c.get("runtime").APP_URL).origin || c.req.header("Sec-Fetch-Site") === "cross-site")) return apiError(c,403,"invalid_origin","Use the deployment origin for erasure.");
    await next();
  })
  .delete("/api/app/bookings/:id", validate("param", idSchema), async (context) => {
    const imported = await context.get("services").eraseImportedBooking(context.req.valid("param").id, context.get("session"));
    if (imported?.kind === "erased" && imported.calendarCleanup === "completed") context.set("inertMutation", true);
    const result = imported ?? await context.get("services").erasure.booking(context.req.valid("param").id, context.get("session"));
    return result.kind === "erased" ? context.json(result, 202) : apiError(context, 404, "booking_not_found", "The booking does not exist.");
  })
  .delete("/api/app/availability-requests/:id", validate("param", idSchema), async (context) => {
    const erased = await context.get("services").erasure.request(context.req.valid("param").id, context.get("session"));
    return erased ? context.body(null, 204) : apiError(context, 404, "request_not_found", "The request does not exist.");
  })
  .get("/api/app/erasures/:id", validate("param", idSchema), async (context) => {
    const result = await context.get("services").erasure.cleanupStatus(context.req.valid("param").id);
    return result ? context.json(result) : apiError(context, 404, "erasure_not_found", "The erasure does not exist.");
  });
