import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { hostDateSchema, ianaTimeZoneSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";
import { validate } from "../../shared/validation";

const publicEventSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80), slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const requestIdSchema = z.object({ id: z.string().length(26) });
const reviewNonceSchema = z.object({ nonce: z.string().min(43).max(128) });
const receiptNonceSchema = z.object({ nonce: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/) });
const requestStateSchema = z.object({ state: z.enum(["handled", "closed"]) });
const requestListQuerySchema = z.object({ state: z.enum(["submitted", "handled", "closed"]).optional() });

export const requestCompositionSchema = z
  .object({
    inviteeName: z.string().trim().min(1).max(160),
    inviteeEmail: z.string().trim().email().max(320),
    inviteeTimezone: ianaTimeZoneSchema,
    note: z.string().trim().max(500).nullable().optional(),
    windows: z.array(z.object({ date: hostDateSchema, ...timeWindowSchema.shape })).min(1).max(20),
  })
  .superRefine((input, context) => {
    if (new Set(input.windows.map((window) => window.date)).size > 10) {
      context.addIssue({ code: "custom", path: ["windows"], message: "Choose no more than 10 dates." });
    }
    for (const date of new Set(input.windows.map((window) => window.date))) {
      validateNonOverlappingWindows(input.windows.filter((window) => window.date === date), context, ["windows"]);
    }
  })
  .transform((input) => ({ ...input, note: input.note?.trim() || null }));

export const availabilityRequestRoutes = new Hono<AppEnvironment>()
  .get(
    "/api/public/events/:handle/:slug/request/receipt",
    async (context, next) => {
      context.header("Cache-Control", "no-store");
      await next();
    },
    validate("param", publicEventSchema),
    validate("query", receiptNonceSchema),
    async (context) => {
      const { handle, slug } = context.req.valid("param");
      const result = await context.get("services").availabilityRequests.getReceipt(handle, slug, context.req.valid("query").nonce);
      if (result.kind === "found") return context.json({ acknowledgement: result.acknowledgement });
      if (result.kind === "expired") return apiError(context, 410, "request_nonce_expired", "This review has expired.");
      return apiError(context, 404, "event_not_available", "This request receipt is not publicly available.");
    },
  )
  .post(
    "/api/public/events/:handle/:slug/request/review",
    validate("param", publicEventSchema),
    validate("json", requestCompositionSchema),
    async (context) => {
      const { handle, slug } = context.req.valid("param");
      const result = await context.get("services").availabilityRequests.issueReview(handle, slug, context.req.valid("json"));
      if (result.kind === "issued") return context.json(result.review, 201);
      if (result.kind === "invalid_dates") return apiError(context, 400, "invalid_request", "Requested dates must be in the future in the invitee timezone.", ["windows"]);
      return apiError(context, 404, "event_not_available", "This event type is not publicly available.");
    },
  )
  .post(
    "/api/public/events/:handle/:slug/request",
    validate("param", publicEventSchema),
    validate("query", reviewNonceSchema),
    validate("json", requestCompositionSchema),
    async (context) => {
      const { handle, slug } = context.req.valid("param");
      const result = await context.get("services").availabilityRequests.submit(handle, slug, context.req.valid("query").nonce, context.req.valid("json"));
      if (result.kind === "created") return context.json({ request: result.request }, 201);
      if (result.kind === "replayed") return context.json({ request: result.request });
      if (result.kind === "blocked") return apiError(context, 409, "request_unavailable", "This request cannot be submitted. Contact the host directly.");
      if (result.kind === "expired") return apiError(context, 410, "request_nonce_expired", "This review has expired. Review your request again to receive a current link.");
      if (result.kind === "mismatched") return apiError(context, 404, "request_nonce_mismatch", "This review does not match the request details.");
      if (result.kind === "invalid_dates") return apiError(context, 400, "invalid_request", "Requested dates must be in the future in the invitee timezone.", ["windows"]);
      return apiError(context, 404, "event_not_available", "This event type is not publicly available.");
    },
  )
  .get("/api/app/availability-requests", validate("query", requestListQuerySchema), async (context) => {
    return context.json(await context.get("services").availabilityRequests.listForOperator(context.req.valid("query").state));
  })
  .get("/api/app/availability-requests/:id", validate("param", requestIdSchema), async (context) => {
    const request = await context.get("services").availabilityRequests.getForOperator(context.req.valid("param").id);
    return request ? context.json(request) : apiError(context, 404, "availability_request_not_found", "The alternative-time request does not exist.");
  })
  .post("/api/app/availability-requests/:id/state", validate("param", requestIdSchema), validate("json", requestStateSchema), async (context) => {
    const result = await context.get("services").availabilityRequests.transitionForOperator(
      context.req.valid("param").id,
      context.req.valid("json").state,
      context.get("session").id,
    );
    if (result === "not_found") return apiError(context, 404, "availability_request_not_found", "The alternative-time request does not exist.");
    if (result === "already_resolved") return apiError(context, 409, "availability_request_resolved", "This alternative-time request has already been resolved.");
    return context.json(result);
  });
